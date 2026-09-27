// Talking to the local `claude` CLI.
//
// Game chat: the model is asked for a short message to the kid plus,
// when it changes the game, ONE code block with the whole game.h. It
// gets no tools and no file access — the server extracts the code,
// compiles it and commits it. The worst a bad reply can do is not build.

import { spawn } from 'node:child_process';

import { ROOT } from './paths.mjs';

const CLAUDE_BIN = process.env.CHIPVIBE_CLAUDE_BIN || 'claude';

/**
 * Run the CLI once. Streams assistant text to onText. Resolves with
 * { text, usage, cost, model }.
 */
export function runClaude(prompt, { model, cwd = ROOT, extraArgs = [], onText, onTool, signal } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--include-partial-messages', '--verbose'];
    if (model) args.push('--model', model);
    args.push(...extraArgs);

    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], signal });
    } catch (err) {
      reject(new Error(`Could not start "${CLAUDE_BIN}": ${err.message}`));
      return;
    }

    let text = '';
    let buf = '';
    let stderr = '';
    let result = null;
    let resolvedModel = model ?? null;
    let streamedThisMessage = false;

    const handle = (e) => {
      if (e.type === 'system' && e.subtype === 'init' && e.model) resolvedModel = e.model;
      if (e.type === 'stream_event') {
        const ev = e.event ?? {};
        if (ev.type === 'message_start') streamedThisMessage = false;
        if (ev.delta?.type === 'text_delta' && ev.delta.text) {
          streamedThisMessage = true;
          text += ev.delta.text;
          onText?.(ev.delta.text);
        }
        return;
      }
      if (e.type === 'assistant') {
        for (const part of e.message?.content ?? []) {
          if (part.type === 'tool_use') onTool?.(part);
          // Only fall back to whole-message text if partials didn't stream it.
          if (part.type === 'text' && part.text && !streamedThisMessage) {
            text += part.text;
            onText?.(part.text);
          }
        }
        return;
      }
      if (e.type === 'result') result = e;
    };

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handle(JSON.parse(line));
        } catch {
          // Non-JSON noise from the CLI; ignore.
        }
      }
    });
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => reject(new Error(`claude CLI failed: ${err.message}`)));
    child.on('close', (code) => {
      if (buf.trim()) {
        try {
          handle(JSON.parse(buf.trim()));
        } catch {
          /* ignore */
        }
      }
      if (result?.is_error || code !== 0) {
        const why = result?.result || stderr.trim() || `exit code ${code}`;
        reject(new Error(`The AI failed: ${String(why).slice(0, 300)}`));
        return;
      }
      resolve({
        text: text || String(result?.result ?? ''),
        usage: result?.usage ?? {},
        cost: result?.total_cost_usd ?? 0,
        model: resolvedModel,
      });
    });
  });
}

// ── Game chat ──────────────────────────────────────────────────────────

export const KIT_API = `The board is a 3×3 grid. Every cell is an RGB LED AND a push-button.
Cells are numbered in reading order, as seen from the front:

    0 1 2
    3 4 5
    6 7 8

The same number addresses a cell's LED and its button. There is no screen, no
speaker and no other buttons — the 9 cells are the whole game.

LEDs (each colour channel is on/off, so exactly 8 colours exist):

    kit::OFF  kit::RED  kit::GREEN  kit::BLUE
    kit::YELLOW  kit::MAGENTA  kit::CYAN  kit::WHITE

    kit::set(cell, colour);   // cell 0..8; others ignored
    kit::get(cell);           // colour currently set
    kit::fill(colour);        // all 9 cells
    kit::clear();             // all off

You never "show" or "refresh" — the kit pushes changed LEDs to the board after
every gameTick() by itself. No brightness control: blink or alternate colours.

Buttons (bit n set = cell n):

    kit::pressed()        // uint16_t: cells that went DOWN since the last tick
    kit::held()           // uint16_t: cells being held down right now
    kit::wasPressed(cell) // bool
    kit::isHeld(cell)     // bool
    kit::firstPressed()   // lowest cell pressed since last tick, or kit::kNone

Button state updates about every 20 ms and is already debounced. Use
pressed()/wasPressed() for taps — each press is reported exactly once.`;

const TWO_BOARDS = `
## This game uses TWO grids

Both boards run this exact same code. They find each other over the radio.

    kit::boardCount()      // 2 for this game
    kit::peerConnected()   // true once the other board has been heard recently
    kit::me()              // 0 or 1: which board THIS is (agreed by both; 0 while waiting)
    kit::send(&data, len)  // up to kit::kMaxMessage (32) bytes to the other board
    kit::receive(buf, sizeof buf)  // returns length of next message (0 = none)

Rules for two boards:
- Until kit::peerConnected() is true, show an obvious "waiting for the other
  board" animation, and pause the game if it drops out.
- Messages can be LOST. Don't send one-off events; send the relevant state
  (e.g. whole board, score, whose turn) a few times a second, and have the
  receiver just apply the latest state. Keep messages small (a struct).
- Use kit::me() to split roles (e.g. board 0 = red player, board 1 = blue),
  and decide who owns what so the two boards never fight over the same state.
- Put a version/type byte first in every message.`;

export function gamePrompt({ game, code, history, message }) {
  const boards = game.boards?.length ?? 1;
  const recent = history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'Kid' : 'You'}: ${m.text}`)
    .join('\n');

  return `You are a friendly game-making helper for kids. Together you're building a game for a homemade toy: ${
    boards === 2 ? 'two' : 'a'
  } 3×3 grid${boards === 2 ? 's' : ''} of colour lights where every light is also a button. Keep your words short and cheerful — the kid reads them.

# How to reply

1. Start with 1–3 short, simple sentences to the kid: what you changed, or an
   answer to their question. No jargon, no code talk.
2. If the game should change, then add exactly ONE \`\`\`cpp code block with the
   COMPLETE new game file (not a diff, not a snippet). If they only asked a
   question or you need to ask one back, send no code.

# The code rules (the game file)

It's the body of a C++ header, #included inside an anonymous namespace. It must
define exactly:

    void gameSetup();   // once at power-on
    void gameTick();    // over and over, every ~2 ms — MUST NOT BLOCK

- No #include lines, no "#pragma once", no namespace. Arduino.h and kit:: are
  already there.
- NEVER call delay(), while(1) or anything that waits. Use millis() timers and
  return quickly — WiFi updates share this loop.
- All state in file-scope static variables.
- ONLY use kit:: for lights, buttons and the radio. Never touch pins, I²C,
  rgb_panel, ht16k33 or WiFi directly.
- No String, std::vector, new/malloc, or exceptions. Integers over floats.
- Always keep something lit or blinking so the board never looks off.
- When a round ends, show the result for a few seconds, then start again by
  itself — there's no reset button.
- Randomness: random(n); call randomSeed(micros()) once in gameSetup().

# The hardware

${KIT_API}
${boards === 2 ? TWO_BOARDS : ''}

# The game so far

Name: ${game.name}${game.description ? `\nIdea: ${game.description}` : ''}

\`\`\`cpp
${code}
\`\`\`
${recent ? `\n# Conversation so far\n\n${recent}\n` : ''}
# The kid just said

"""
${message}
"""`;
}

export function repairPrompt({ game, code, errors }) {
  return `${gamePrompt({ game, code, history: [], message: 'Please fix the build errors below.' })}

# It did not compile

The code above failed to build. Fix every error without changing how the game
plays. Reply with one short sentence and the complete fixed code block.

Compiler output:
${errors}`;
}

/** Split a reply into the kid-facing message and the code (if any). */
export function parseReply(text) {
  const blocks = [...text.matchAll(/```(?:cpp|c\+\+|c|arduino)?\s*\n([\s\S]*?)```/g)];
  const withGame = blocks.find((b) => /void\s+gameTick\s*\(/.test(b[1]));
  const code = withGame ? withGame[1].trim() + '\n' : null;
  const message = text.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return { message: message || (code ? 'Here you go!' : ''), code };
}
