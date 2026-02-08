import { useState } from 'react';
import { clsx } from 'clsx';
import { useCreateAgent } from '../hooks/useQueries';
import { api } from '../lib/api';
import type { AgentRole } from '../types';

interface HireAgentModalProps {
  onClose: () => void;
}

const ROLES: { value: AgentRole; label: string; color: string; description: string }[] = [
  { value: 'pm', label: 'Project Manager', color: 'bg-blue-600', description: 'Orchestrates tasks and coordinates agents' },
  { value: 'research', label: 'Research', color: 'bg-purple-600', description: 'Gathers information and performs analysis' },
  { value: 'marketing', label: 'Marketing', color: 'bg-pink-600', description: 'Creates copy and marketing materials' },
  { value: 'developer', label: 'Developer', color: 'bg-green-600', description: 'Writes and modifies code' },
  { value: 'qa', label: 'QA', color: 'bg-orange-600', description: 'Tests and validates work' },
];

const PERSONALITY_STYLES = ['analytical', 'creative', 'systematic', 'pragmatic'] as const;
const COMMUNICATION_STYLES = ['concise', 'verbose', 'formal', 'casual'] as const;
const DECISION_STYLES = ['data-driven', 'intuitive', 'consensus-seeking', 'decisive'] as const;

const PRESET_STRENGTHS: Record<AgentRole, string[]> = {
  pm: ['task_decomposition', 'priority_assessment', 'blocker_identification', 'timeline_management', 'stakeholder_communication'],
  research: ['market_analysis', 'competitive_intelligence', 'trend_identification', 'source_verification', 'data_synthesis'],
  marketing: ['copywriting', 'brand_voice_consistency', 'audience_targeting', 'value_proposition_crafting', 'ab_variant_generation'],
  developer: ['code_implementation', 'api_integration', 'testing', 'code_review', 'debugging', 'refactoring'],
  qa: ['test_case_design', 'edge_case_identification', 'regression_testing', 'quality_gate_enforcement', 'bug_reproduction'],
};

export function HireAgentModal({ onClose }: HireAgentModalProps) {
  const createAgent = useCreateAgent();

  // Form state
  const [step, setStep] = useState<'basics' | 'personality' | 'permissions' | 'runtime'>('basics');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AgentRole>('developer');
  const [description, setDescription] = useState('');

  // Personality
  const [style, setStyle] = useState<typeof PERSONALITY_STYLES[number]>('pragmatic');
  const [communication, setCommunication] = useState<typeof COMMUNICATION_STYLES[number]>('concise');
  const [decisionMaking, setDecisionMaking] = useState<typeof DECISION_STYLES[number]>('data-driven');
  const [strengths, setStrengths] = useState<string[]>([]);
  const [customStrength, setCustomStrength] = useState('');

  // Permissions
  const [fileAccess, setFileAccess] = useState(true);
  const [shellAccess, setShellAccess] = useState(false);
  const [gitAccess, setGitAccess] = useState(false);
  const [browserAccess, setBrowserAccess] = useState(false);
  const [maxTokens, setMaxTokens] = useState(50000);
  const [maxCost, setMaxCost] = useState(5);
  const [maxRuntime, setMaxRuntime] = useState(300);

  // Runtime
  const [runtimeType, setRuntimeType] = useState<'in-process' | 'http' | 'subprocess'>('subprocess');
  const [providerPreset, setProviderPreset] = useState<'claude' | 'codex' | 'custom'>('claude');
  const [oauthToken, setOauthToken] = useState('');
  const [modelOverride, setModelOverride] = useState('');
  const [httpUrl, setHttpUrl] = useState('');
  const [httpHealthPath, setHttpHealthPath] = useState('/health');
  const [command, setCommand] = useState('bun');
  const [args, setArgs] = useState('scripts/agent-worker.ts --agent developer');
  const [cwd, setCwd] = useState('');
  const [protocol, setProtocol] = useState<'stdio' | 'http'>('stdio');
  const [timeoutMs, setTimeoutMs] = useState(120000);
  const [oauthState, setOauthState] = useState('');
  const [oauthSecretId, setOauthSecretId] = useState('');
  const [oauthRedirectUrl, setOauthRedirectUrl] = useState('');
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'pending' | 'received' | 'exchanged' | 'error'>('idle');
  const [codexRedirectUrl, setCodexRedirectUrl] = useState('http://localhost:1455/auth/callback');

  const [error, setError] = useState<string | null>(null);

  const getWorkerAgentKind = (agentRole: AgentRole) => {
    if (agentRole === 'pm' || agentRole === 'research' || agentRole === 'marketing' || agentRole === 'developer') {
      return agentRole;
    }
    return 'developer';
  };

  // Auto-fill description and strengths when role changes
  const handleRoleChange = (newRole: AgentRole) => {
    setRole(newRole);
    const preset = ROLES.find((r) => r.value === newRole);
    if (preset && !description) {
      setDescription(preset.description);
    }
    if (strengths.length === 0) {
      setStrengths(PRESET_STRENGTHS[newRole].slice(0, 3));
    }
    const workerRole = getWorkerAgentKind(newRole);
    setArgs(`scripts/agent-worker.ts --agent ${workerRole}`);
  };

  const toggleStrength = (s: string) => {
    setStrengths((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const addCustomStrength = () => {
    const s = customStrength.trim().toLowerCase().replace(/\s+/g, '_');
    if (s && !strengths.includes(s)) {
      setStrengths([...strengths, s]);
      setCustomStrength('');
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (runtimeType === 'http' && !httpUrl.trim()) {
      setError('HTTP runtime requires an endpoint URL');
      return;
    }

    if (runtimeType === 'subprocess' && !command.trim()) {
      setError('Subprocess runtime requires a command');
      return;
    }

    if (providerPreset === 'codex' && !oauthSecretId && !oauthToken.trim()) {
      setError('Codex requires OAuth (start OAuth flow or paste a token)');
      return;
    }

    setError(null);

    try {
      const runtimeEnv: Record<string, string> = {};
      const envSecrets: Record<string, string> = {};
      let authTokenSecret: string | undefined = oauthSecretId || undefined;

      if (!authTokenSecret && oauthToken.trim()) {
        authTokenSecret = await api.secrets.create({
          name: `${name.trim().toLowerCase()}-oauth`,
          value: oauthToken.trim(),
        });
      }
      if (runtimeType === 'subprocess') {
        runtimeEnv.ALLOW_SHELL = shellAccess ? 'true' : 'false';
        runtimeEnv.ALLOW_GIT = gitAccess ? 'true' : 'false';

        if (providerPreset === 'claude') {
          runtimeEnv.LLM_PROVIDER = 'anthropic';
        } else if (providerPreset === 'codex') {
          runtimeEnv.LLM_PROVIDER = 'openai';
        }

        if (authTokenSecret) {
          envSecrets.LLM_API_KEY = authTokenSecret;
        }

        if (modelOverride.trim()) {
          runtimeEnv.LLM_DEFAULT_MODEL = modelOverride.trim();
        }
      }

      const runtimeConfig =
        runtimeType === 'in-process'
          ? { type: 'in-process' as const }
          : runtimeType === 'http'
            ? {
                type: 'http' as const,
                url: httpUrl.trim(),
                authToken: undefined,
                authTokenSecret,
                timeoutMs,
                healthPath: httpHealthPath.trim() || undefined,
              }
            : {
                type: 'subprocess' as const,
                command: command.trim(),
                args: args.split(/\s+/).filter(Boolean),
                cwd: cwd.trim() || undefined,
                env: Object.keys(runtimeEnv).length ? runtimeEnv : undefined,
                envSecrets: Object.keys(envSecrets).length ? envSecrets : undefined,
                protocol,
                timeoutMs,
              };

      await createAgent.mutateAsync({
        name: name.trim().toLowerCase(),
        role,
        description: description || undefined,
        permissions: {
          file: fileAccess,
          shell: shellAccess,
          git: gitAccess,
          browser: browserAccess,
        },
        budget: {
          maxTokens,
          maxCost,
          maxRuntime,
        },
        personality: {
          style,
          communication,
          decision_making: decisionMaking,
        },
        strengths,
        runtime: runtimeConfig,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startCodexOAuth = async () => {
    setError(null);
    try {
      setOauthStatus('pending');
      const result = await api.oauth.codex.start({
        redirectUrl: codexRedirectUrl || undefined,
      });
      setOauthState(result.state);
      setOauthRedirectUrl(result.redirectUrl);
      window.open(result.authUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setOauthStatus('error');
      setError((err as Error).message);
    }
  };

  const finishCodexOAuth = async () => {
    if (!oauthState) {
      setError('OAuth state not initialized');
      return;
    }
    try {
      const result = await api.oauth.codex.finish({
        state: oauthState,
        redirectUrl: oauthRedirectUrl || undefined,
      });
      setOauthSecretId(result.secretId);
      setOauthStatus('exchanged');
    } catch (err) {
      setOauthStatus('error');
      setError((err as Error).message);
    }
  };

  const checkCodexStatus = async () => {
    if (!oauthState) return;
    try {
      const result = await api.oauth.codex.status(oauthState);
      setOauthStatus(result.status);
    } catch (err) {
      setOauthStatus('error');
      setError((err as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg w-[520px] max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Hire Agent</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add a new agent to your organization</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">
            &times;
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-gray-700">
          {[
            { id: 'basics' as const, label: 'Basics' },
            { id: 'personality' as const, label: 'Personality' },
            { id: 'permissions' as const, label: 'Permissions' },
            { id: 'runtime' as const, label: 'Runtime' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStep(tab.id)}
              className={clsx(
                'flex-1 px-3 py-2 text-sm font-medium',
                step === tab.id
                  ? 'text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-white',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 'basics' && (
            <>
              {/* Name */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Agent Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. ken, alice, bob"
                  className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Agent ID will be agent:{name.trim().toLowerCase() || '...'}</p>
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Role</label>
                <div className="grid grid-cols-5 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => handleRoleChange(r.value)}
                      className={clsx(
                        'flex flex-col items-center gap-1 p-2 rounded border text-xs',
                        role === r.value
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-gray-600 hover:border-gray-500',
                      )}
                    >
                      <div className={clsx('w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold', r.color)}>
                        {r.label[0]}
                      </div>
                      <span className="text-gray-300">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  placeholder="What does this agent do?"
                />
              </div>
            </>
          )}

          {step === 'personality' && (
            <>
              {/* Thinking style */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Thinking Style</label>
                <div className="flex gap-2">
                  {PERSONALITY_STYLES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      className={clsx(
                        'px-3 py-1.5 rounded text-sm capitalize',
                        style === s ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Communication */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Communication</label>
                <div className="flex gap-2">
                  {COMMUNICATION_STYLES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCommunication(c)}
                      className={clsx(
                        'px-3 py-1.5 rounded text-sm capitalize',
                        communication === c ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Decision Making */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Decision Making</label>
                <div className="flex flex-wrap gap-2">
                  {DECISION_STYLES.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDecisionMaking(d)}
                      className={clsx(
                        'px-3 py-1.5 rounded text-sm capitalize',
                        decisionMaking === d ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Strengths */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Strengths</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PRESET_STRENGTHS[role].map((s) => (
                    <button
                      key={s}
                      onClick={() => toggleStrength(s)}
                      className={clsx(
                        'px-2 py-1 rounded text-xs',
                        strengths.includes(s)
                          ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500'
                          : 'bg-gray-700 text-gray-400 border border-transparent hover:border-gray-500',
                      )}
                    >
                      {s.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
                {/* Custom strengths added */}
                {strengths
                  .filter((s) => !PRESET_STRENGTHS[role].includes(s))
                  .map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-600/30 text-emerald-300 border border-emerald-500 mr-1 mb-1"
                    >
                      {s.replace(/_/g, ' ')}
                      <button onClick={() => toggleStrength(s)} className="text-emerald-400 hover:text-white">&times;</button>
                    </span>
                  ))}
                {/* Add custom */}
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={customStrength}
                    onChange={(e) => setCustomStrength(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCustomStrength()}
                    placeholder="Add custom strength..."
                    className="flex-1 px-2 py-1 bg-gray-700 rounded text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={addCustomStrength}
                    className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-gray-300"
                  >
                    Add
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 'permissions' && (
            <>
              {/* Permission toggles */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Permissions</label>
                <div className="space-y-2">
                  {[
                    { label: 'File System', value: fileAccess, set: setFileAccess, desc: 'Read and write files' },
                    { label: 'Shell', value: shellAccess, set: setShellAccess, desc: 'Execute shell commands' },
                    { label: 'Git', value: gitAccess, set: setGitAccess, desc: 'Git operations (commit, push)' },
                    { label: 'Browser', value: browserAccess, set: setBrowserAccess, desc: 'Web browsing and HTTP requests' },
                  ].map((perm) => (
                    <label key={perm.label} className="flex items-center gap-3 p-2 rounded hover:bg-gray-700/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={perm.value}
                        onChange={() => perm.set(!perm.value)}
                        className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-sm text-gray-200">{perm.label}</span>
                        <p className="text-xs text-gray-500">{perm.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Budget Limits</label>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Max Tokens</span>
                      <span>{maxTokens.toLocaleString()}</span>
                    </div>
                    <input
                      type="range"
                      min={10000}
                      max={200000}
                      step={10000}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Max Cost</span>
                      <span>${maxCost}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      step={1}
                      value={maxCost}
                      onChange={(e) => setMaxCost(Number(e.target.value))}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Max Runtime</span>
                      <span>{maxRuntime}s</span>
                    </div>
                    <input
                      type="range"
                      min={60}
                      max={1800}
                      step={60}
                      value={maxRuntime}
                      onChange={(e) => setMaxRuntime(Number(e.target.value))}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'runtime' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Runtime Type</label>
                <div className="flex gap-2">
                  {[
                    { id: 'subprocess' as const, label: 'Local Subprocess' },
                    { id: 'http' as const, label: 'HTTP Agent' },
                    { id: 'in-process' as const, label: 'In-Process' },
                  ].map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRuntimeType(r.id)}
                      className={clsx(
                        'px-3 py-1.5 rounded text-sm',
                        runtimeType === r.id ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {runtimeType === 'in-process' && (
                  <p className="text-xs text-amber-400 mt-2">
                    In-process agents share server environment. For per-agent OAuth tokens, use Subprocess or HTTP.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Provider Preset</label>
                <div className="flex gap-2">
                  {[
                    { id: 'claude' as const, label: 'Claude' },
                    { id: 'codex' as const, label: 'Codex' },
                    { id: 'custom' as const, label: 'Custom' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setProviderPreset(p.id)}
                      className={clsx(
                        'px-3 py-1.5 rounded text-sm',
                        providerPreset === p.id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {(runtimeType === 'subprocess' || runtimeType === 'http') && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">OAuth / API Token</label>
                  <input
                    type="password"
                    value={oauthToken}
                    onChange={(e) => setOauthToken(e.target.value)}
                    placeholder="Paste OAuth token or API key"
                    className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Stored in agent runtime config. Use HTTP runtime for bearer-token auth.
                  </p>
                </div>
              )}

              {providerPreset === 'claude' && (
                <p className="text-xs text-gray-500">
                  OpenClaw uses the Claude setup-token flow (run `claude setup-token` and paste the token here).
                </p>
              )}

              {providerPreset === 'codex' && (
                <div className="border border-gray-700 rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-200">Codex OAuth</p>
                    <button
                      onClick={startCodexOAuth}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white"
                    >
                      Start OAuth
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    OAuth uses local callback on http://localhost:1455/auth/callback. No client ID input required.
                  </p>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Redirect URL</label>
                    <input
                      type="text"
                      value={codexRedirectUrl}
                      onChange={(e) => setCodexRedirectUrl(e.target.value)}
                      className="w-full px-2 py-1.5 bg-gray-700 rounded text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Paste redirect URL (if browser callback fails)</label>
                    <input
                      type="text"
                      value={oauthRedirectUrl}
                      onChange={(e) => setOauthRedirectUrl(e.target.value)}
                      placeholder="http://127.0.0.1:1455/auth/callback?code=..."
                      className="w-full px-2 py-1.5 bg-gray-700 rounded text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={checkCodexStatus}
                      className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-gray-200"
                    >
                      Check Status
                    </button>
                    <button
                      onClick={finishCodexOAuth}
                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-xs text-white"
                    >
                      Finish OAuth
                    </button>
                    <span className="text-xs text-gray-400 self-center">Status: {oauthStatus}</span>
                  </div>
                  {oauthSecretId && (
                    <p className="text-xs text-emerald-300">OAuth token stored as secret.</p>
                  )}
                </div>
              )}

              {runtimeType === 'http' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Agent Endpoint URL</label>
                    <input
                      type="text"
                      value={httpUrl}
                      onChange={(e) => setHttpUrl(e.target.value)}
                      placeholder="http://localhost:4000"
                      className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Health Path</label>
                    <input
                      type="text"
                      value={httpHealthPath}
                      onChange={(e) => setHttpHealthPath(e.target.value)}
                      placeholder="/health"
                      className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  {!oauthToken.trim() && (
                    <p className="text-xs text-amber-400">HTTP runtime is configured to use OAuth/Bearer token. Add a token to authenticate.</p>
                  )}
                </>
              )}

              {runtimeType === 'subprocess' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Command</label>
                    <input
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="bun"
                      className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Args</label>
                    <input
                      type="text"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="scripts/agent-worker.ts --agent developer"
                      className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Default worker supports pm/research/marketing/developer.</p>
                    {role === 'qa' && (
                      <p className="text-xs text-amber-400 mt-1">QA role is not supported by the default worker. Use HTTP or custom subprocess.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Working Directory (optional)</label>
                    <input
                      type="text"
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      placeholder="Leave empty to use repo root"
                      className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Protocol</label>
                    <div className="flex gap-2">
                      {(['stdio', 'http'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setProtocol(p)}
                          className={clsx(
                            'px-3 py-1.5 rounded text-sm',
                            protocol === p ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm text-gray-400 mb-1">Model Override (optional)</label>
                <input
                  type="text"
                  value={modelOverride}
                  onChange={(e) => setModelOverride(e.target.value)}
                  placeholder={providerPreset === 'claude' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini'}
                  className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Timeout (ms)</label>
                <input
                  type="number"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-between">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
            >
              Cancel
            </button>
            {step !== 'runtime' ? (
              <button
                onClick={() => {
                  const order = ['basics', 'personality', 'permissions', 'runtime'] as const;
                  const nextIndex = Math.min(order.indexOf(step) + 1, order.length - 1);
                  setStep(order[nextIndex]!);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={createAgent.isPending || !name.trim()}
                className={clsx(
                  'px-4 py-2 rounded text-sm text-white',
                  createAgent.isPending || !name.trim()
                    ? 'bg-blue-800 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-500',
                )}
              >
                {createAgent.isPending ? 'Hiring...' : 'Hire Agent'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
