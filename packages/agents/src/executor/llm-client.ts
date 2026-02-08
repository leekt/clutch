import pino from 'pino';

const logger = pino({ name: 'llm-client' });

/**
 * LLM message format
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM completion options
 */
export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

/**
 * LLM completion response
 */
export interface CompletionResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: number;
  model: string;
  finishReason: 'stop' | 'length' | 'tool_use' | 'error';
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: unknown;
    }>;
    required?: string[];
  };
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Completion response with potential tool calls
 */
export interface CompletionWithToolsResponse extends CompletionResponse {
  toolCalls?: ToolCall[];
}

// Cost per 1K tokens (approximate)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
};

/**
 * LLM client abstraction supporting OpenAI and Anthropic
 */
export class LLMClient {
  private provider: 'openai' | 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config?: {
    provider?: 'openai' | 'anthropic';
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) {
    const envProvider = process.env.LLM_PROVIDER as 'openai' | 'anthropic' | undefined;
    const envApiKey = process.env.LLM_API_KEY;
    const envBaseUrl = process.env.LLM_BASE_URL;
    const envModel = process.env.LLM_DEFAULT_MODEL;

    // Auto-detect provider from config/env
    if (config?.provider) {
      this.provider = config.provider;
    } else if (envProvider) {
      this.provider = envProvider;
    } else if (process.env.ANTHROPIC_API_KEY) {
      this.provider = 'anthropic';
    } else {
      this.provider = 'openai';
    }

    // Get API key
    if (config?.apiKey) {
      this.apiKey = config.apiKey;
    } else if (envApiKey) {
      this.apiKey = envApiKey;
    } else if (this.provider === 'anthropic') {
      this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    } else {
      this.apiKey = process.env.OPENAI_API_KEY || '';
    }

    // Set base URL
    if (config?.baseUrl) {
      this.baseUrl = config.baseUrl;
    } else if (envBaseUrl) {
      this.baseUrl = envBaseUrl;
    } else if (this.provider === 'anthropic') {
      this.baseUrl = 'https://api.anthropic.com';
    } else {
      this.baseUrl = 'https://api.openai.com';
    }

    // Set default model
    if (config?.defaultModel) {
      this.defaultModel = config.defaultModel;
    } else if (envModel) {
      this.defaultModel = envModel;
    } else if (this.provider === 'anthropic') {
      this.defaultModel = 'claude-3-5-sonnet-20241022';
    } else {
      this.defaultModel = 'gpt-4o-mini';
    }
  }

  /**
   * Create a completion
   */
  async complete(
    messages: LLMMessage[],
    options: CompletionOptions = {}
  ): Promise<CompletionResponse> {
    const model = options.model || this.defaultModel;

    if (this.provider === 'anthropic') {
      return this.completeAnthropic(messages, { ...options, model });
    } else {
      return this.completeOpenAI(messages, { ...options, model });
    }
  }

  /**
   * Create a completion with tool support
   */
  async completeWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options: CompletionOptions = {}
  ): Promise<CompletionWithToolsResponse> {
    const model = options.model || this.defaultModel;

    if (this.provider === 'anthropic') {
      return this.completeAnthropicWithTools(messages, tools, { ...options, model });
    } else {
      return this.completeOpenAIWithTools(messages, tools, { ...options, model });
    }
  }

  private async completeOpenAI(
    messages: LLMMessage[],
    options: CompletionOptions & { model: string }
  ): Promise<CompletionResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
        stop: options.stopSequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ error, status: response.status }, 'OpenAI API error');
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const usage = {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    };

    const costs = MODEL_COSTS[options.model] || { input: 0.001, output: 0.002 };
    const cost = (usage.inputTokens * costs.input + usage.outputTokens * costs.output) / 1000;

    return {
      content: data.choices[0]?.message.content || '',
      usage,
      cost,
      model: options.model,
      finishReason: data.choices[0]?.finish_reason === 'stop' ? 'stop' : 'length',
    };
  }

  private async completeOpenAIWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options: CompletionOptions & { model: string }
  ): Promise<CompletionWithToolsResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.7,
        tools: tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: 'auto',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const usage = {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    };

    const costs = MODEL_COSTS[options.model] || { input: 0.001, output: 0.002 };
    const cost = (usage.inputTokens * costs.input + usage.outputTokens * costs.output) / 1000;

    const toolCalls = data.choices[0]?.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: data.choices[0]?.message.content || '',
      usage,
      cost,
      model: options.model,
      finishReason: data.choices[0]?.finish_reason === 'tool_calls' ? 'tool_use' : 'stop',
      toolCalls,
    };
  }

  private async completeAnthropic(
    messages: LLMMessage[],
    options: CompletionOptions & { model: string }
  ): Promise<CompletionResponse> {
    // Convert messages to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const nonSystemMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        system: systemMessage,
        messages: nonSystemMessages,
        temperature: options.temperature ?? 0.7,
        stop_sequences: options.stopSequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ error, status: response.status }, 'Anthropic API error');
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
      stop_reason: string;
    };

    const usage = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    };

    const costs = MODEL_COSTS[options.model] || { input: 0.003, output: 0.015 };
    const cost = (usage.inputTokens * costs.input + usage.outputTokens * costs.output) / 1000;

    return {
      content: data.content.find(c => c.type === 'text')?.text || '',
      usage,
      cost,
      model: options.model,
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  private async completeAnthropicWithTools(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options: CompletionOptions & { model: string }
  ): Promise<CompletionWithToolsResponse> {
    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const nonSystemMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        system: systemMessage,
        messages: nonSystemMessages,
        temperature: options.temperature ?? 0.7,
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
      stop_reason: string;
    };

    const usage = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    };

    const costs = MODEL_COSTS[options.model] || { input: 0.003, output: 0.015 };
    const cost = (usage.inputTokens * costs.input + usage.outputTokens * costs.output) / 1000;

    const textContent = data.content.find(c => c.type === 'text')?.text || '';
    const toolCalls = data.content
      .filter(c => c.type === 'tool_use')
      .map(c => ({
        id: c.id || '',
        name: c.name || '',
        arguments: c.input || {},
      }));

    return {
      content: textContent,
      usage,
      cost,
      model: options.model,
      finishReason: data.stop_reason === 'tool_use' ? 'tool_use' : 'stop',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

// Default client instance
export const llmClient = new LLMClient();
