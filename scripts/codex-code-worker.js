#!/usr/bin/env node
const pty = require('node-pty');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function buildPrompt(dispatch, context) {
  const parts = [
    `Action: ${dispatch.action}`,
    `Task ID: ${dispatch.taskId}`,
    `Input: ${JSON.stringify(dispatch.input)}`,
  ];
  if (context.workingMemory) parts.push(`Working Memory:\n${context.workingMemory}`);
  if (context.longTermMemory) parts.push(`Long-Term Memory:\n${context.longTermMemory}`);
  return parts.join('\n\n');
}

function parseOutput(raw) {
  try {
    const json = JSON.parse(raw);
    const text =
      json.output_text ||
      (json.content || []).map((c) => c.text).filter(Boolean).join('\n') ||
      '';
    return { text, json };
  } catch {
    return { text: raw };
  }
}

async function runCodex(prompt) {
  const cwd = process.env.CLUTCH_CODEX_CWD || process.cwd();
  const bin = process.env.CLUTCH_CODEX_BIN || 'codex';

  const args = [
    prompt,
  ];

  return new Promise((resolve) => {
    const shell = pty.spawn(bin, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    let output = '';
    shell.onData((data) => { output += data; });
    shell.onExit(({ exitCode }) => resolve({ output, code: exitCode }));
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error('No input provided to Codex worker');

  const input = JSON.parse(raw);
  const prompt = buildPrompt(input.dispatch, input.context || {});
  const start = Date.now();

  const result = await runCodex(prompt);
  const runtime = Date.now() - start;

  if (result.code !== 0) {
    process.stdout.write(JSON.stringify({
      taskId: input.dispatch.taskId,
      success: false,
      error: {
        code: 'CODEX_CLI_ERROR',
        message: `codex exited with code ${result.code}`,
        retryable: true,
      },
      usage: { cost: 0, runtime, tokens: 0 },
    }));
    return;
  }

  process.stdout.write(JSON.stringify({
    taskId: input.dispatch.taskId,
    success: true,
    output: { content: result.output, raw: result.output },
    usage: { cost: 0, runtime, tokens: 0 },
  }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    taskId: 'unknown',
    success: false,
    error: { code: 'CODEX_WORKER_ERROR', message: String(err), retryable: false },
    usage: { cost: 0, runtime: 0, tokens: 0 },
  }));
  process.exit(1);
});
