#!/usr/bin/env node
const { spawn } = require('child_process');

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
  // For chat actions, just use the message directly
  if (dispatch.action === 'chat' && dispatch.input && dispatch.input.message) {
    return String(dispatch.input.message);
  }

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

async function runClaude(prompt) {
  const allowedTools = process.env.CLUTCH_CLAUDE_ALLOWED_TOOLS || '';
  const permissionMode = process.env.CLUTCH_CLAUDE_PERMISSION_MODE || 'default';
  const cwd = process.env.CLUTCH_CLAUDE_CWD || process.cwd();
  const bin = process.env.CLUTCH_CLAUDE_BIN || 'claude';

  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--permission-mode',
    permissionMode,
  ];

  if (allowedTools.trim()) {
    args.push('--tools', allowedTools);
  }

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, code: 1 });
    });
  });
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error('No input provided to Claude Code worker');

  const input = JSON.parse(raw);
  const prompt = buildPrompt(input.dispatch, input.context || {});
  const start = Date.now();

  const result = await runClaude(prompt);
  const runtime = Date.now() - start;

  if (result.code !== 0) {
    process.stdout.write(JSON.stringify({
      taskId: input.dispatch.taskId,
      success: false,
      error: {
        code: 'CLAUDE_CODE_ERROR',
        message: result.stderr || `claude exited with code ${result.code}`,
        retryable: true,
      },
      usage: { cost: 0, runtime, tokens: 0 },
    }));
    return;
  }

  const parsed = parseOutput(result.stdout);
  process.stdout.write(JSON.stringify({
    taskId: input.dispatch.taskId,
    success: true,
    output: { content: parsed.text, raw: parsed.json || result.stdout },
    usage: { cost: 0, runtime, tokens: 0 },
  }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    taskId: 'unknown',
    success: false,
    error: { code: 'CLAUDE_CODE_WORKER_ERROR', message: String(err), retryable: false },
    usage: { cost: 0, runtime: 0, tokens: 0 },
  }));
  process.exit(1);
});
