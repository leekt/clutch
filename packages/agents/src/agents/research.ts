import pino from 'pino';

import { BaseAgent, type AgentContext, type ExecutionResult, type TaskDispatch } from '../executor/base-agent.js';
import { LLMClient, type LLMMessage, type ToolDefinition } from '../executor/llm-client.js';

const logger = pino({ name: 'agent-research' });

/**
 * Research finding with confidence level
 */
interface Finding {
  claim: string;
  confidence: 'high' | 'medium' | 'low';
  sources: Source[];
  notes?: string;
}

/**
 * Source citation
 */
interface Source {
  title: string;
  url: string;
  publishDate?: string;
  author?: string;
  credibility?: 'high' | 'medium' | 'low';
}

/**
 * Research result structure
 */
interface ResearchResult {
  summary: string;
  findings: Finding[];
  methodology?: string;
  limitations?: string[];
  recommendations?: string[];
  rawSources: Source[];
}

/**
 * Research Agent Tools
 */
const RESEARCH_TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the web for information on a topic',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_page',
    description: 'Fetch and extract content from a web page',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the page to fetch',
        },
        extractSelector: {
          type: 'string',
          description: 'CSS selector to extract specific content (optional)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'report_findings',
    description: 'Report structured research findings',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Executive summary of findings',
        },
        findings: {
          type: 'array',
          description: 'List of findings with confidence levels',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string', description: 'The claim or finding' },
              confidence: {
                type: 'string',
                description: 'Confidence level',
                enum: ['high', 'medium', 'low'],
              },
              sources: {
                type: 'array',
                description: 'Sources supporting this claim',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    url: { type: 'string' },
                    publishDate: { type: 'string' },
                  },
                  required: ['title', 'url'],
                },
              },
              notes: { type: 'string', description: 'Additional notes or caveats' },
            },
            required: ['claim', 'confidence', 'sources'],
          },
        },
        methodology: {
          type: 'string',
          description: 'Description of research methodology',
        },
        limitations: {
          type: 'array',
          description: 'Limitations of this research',
          items: { type: 'string' },
        },
        recommendations: {
          type: 'array',
          description: 'Recommendations based on findings',
          items: { type: 'string' },
        },
      },
      required: ['summary', 'findings'],
    },
  },
];

/**
 * Research Agent
 *
 * Responsibilities:
 * - Web search: Find relevant information sources
 * - Information synthesis: Combine findings from multiple sources
 * - Structured output: Present findings with confidence levels
 * - Citation collection: Track all sources with proper attribution
 */
export class ResearchAgent extends BaseAgent {
  private llm: LLMClient;
  private searchApiKey?: string;

  constructor(agentId: string = 'agent:research') {
    super(agentId, 'research', 'research');
    this.llm = new LLMClient();
    this.searchApiKey = process.env.SEARCH_API_KEY || process.env.SERPER_API_KEY;
  }

  getCapabilities() {
    return [
      { id: 'skill:research', version: '1.0', tags: ['analysis', 'search'] },
      { id: 'skill:market-analysis', version: '1.0', tags: ['business'] },
      { id: 'skill:competitive-intelligence', version: '1.0', tags: ['business'] },
      { id: 'skill:data-synthesis', version: '1.0', tags: ['analysis'] },
    ];
  }

  getAvailableActions() {
    return [
      'research',          // General research on a topic
      'market_analysis',   // Analyze market/industry
      'competitive',       // Competitive analysis
      'fact_check',        // Verify claims with sources
      'summarize',         // Summarize information
    ];
  }

  protected async executeTask(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const action = dispatch.action || 'research';

    switch (action) {
      case 'research':
        return this.conductResearch(dispatch, context);

      case 'market_analysis':
        return this.conductMarketAnalysis(dispatch, context);

      case 'competitive':
        return this.conductCompetitiveAnalysis(dispatch, context);

      case 'fact_check':
        return this.factCheck(dispatch, context);

      case 'summarize':
        return this.summarizeInformation(dispatch, context);

      default:
        return this.conductResearch(dispatch, context);
    }
  }

  /**
   * Conduct general research on a topic
   */
  private async conductResearch(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const topic = dispatch.input.topic as string || dispatch.input.title as string || '';
    const questions = dispatch.input.questions as string[] || [];
    const depth = dispatch.input.depth as 'quick' | 'standard' | 'deep' || 'standard';

    if (!topic) {
      return {
        success: false,
        error: {
          code: 'MISSING_TOPIC',
          message: 'Research topic is required',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(5, 'Starting research');

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(context);

    // Collect sources through search
    context.reportProgress(15, 'Searching for sources');
    const searchResults = await this.performSearch(topic, depth);

    context.reportProgress(35, `Found ${searchResults.length} sources`);

    // Synthesize findings
    const userPrompt = this.buildResearchPrompt(topic, questions, searchResults);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // Add working memory context
    if (context.workingMemory) {
      messages.push({
        role: 'user',
        content: `Previous research context:\n${context.workingMemory}`,
      });
    }

    context.reportProgress(50, 'Synthesizing findings');

    try {
      const response = await this.llm.completeWithTools(messages, RESEARCH_TOOLS, {
        maxTokens: 3000,
        temperature: 0.3,
      });

      context.emitToolCall('llm.complete', { topic, depth }, response);

      context.reportProgress(80, 'Structuring results');

      // Extract research result
      let result: ResearchResult | null = null;

      if (response.toolCalls?.length) {
        const reportCall = response.toolCalls.find(tc => tc.name === 'report_findings');
        if (reportCall) {
          result = reportCall.arguments as unknown as ResearchResult;
        }
      }

      // Fallback: parse from text
      if (!result) {
        result = this.parseResearchFromText(response.content, searchResults);
      }

      if (!result) {
        return {
          success: false,
          error: {
            code: 'SYNTHESIS_FAILED',
            message: 'Failed to synthesize research findings',
            retryable: true,
          },
          usage: {
            tokens: response.usage.totalTokens,
            cost: response.cost,
          },
        };
      }

      // Add raw sources
      result.rawSources = searchResults;

      context.reportProgress(95, 'Finalizing research');

      return {
        success: true,
        output: {
          type: 'research_report',
          topic,
          ...result,
          metadata: {
            sourceCount: searchResults.length,
            findingCount: result.findings.length,
            highConfidenceCount: result.findings.filter(f => f.confidence === 'high').length,
          },
        },
        memoryUpdates: {
          workingNotes: `Research on "${topic}": ${result.findings.length} findings from ${searchResults.length} sources`,
          domainKnowledge: result.findings
            .filter(f => f.confidence === 'high')
            .slice(0, 3)
            .map(f => ({
              topic: topic,
              content: f.claim,
            })),
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Research failed');
      return {
        success: false,
        error: {
          code: 'RESEARCH_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Conduct market analysis
   */
  private async conductMarketAnalysis(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const market = dispatch.input.market as string || dispatch.input.topic as string || '';
    const aspects = dispatch.input.aspects as string[] || ['size', 'growth', 'trends', 'players'];

    // Modify input for research with market-specific questions
    const questions = aspects.map(a => `What is the ${a} of the ${market} market?`);

    return this.conductResearch(
      {
        ...dispatch,
        input: {
          ...dispatch.input,
          topic: `${market} market analysis`,
          questions,
          depth: 'standard',
        },
      },
      context
    );
  }

  /**
   * Conduct competitive analysis
   */
  private async conductCompetitiveAnalysis(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const competitors = dispatch.input.competitors as string[] || [];
    const product = dispatch.input.product as string || '';
    const aspects = dispatch.input.aspects as string[] || ['pricing', 'features', 'market_share'];

    const topic = competitors.length > 0
      ? `Competitive analysis: ${competitors.join(', ')}`
      : `Competitors for ${product}`;

    const questions = [
      ...competitors.map(c => `What are the key features of ${c}?`),
      ...aspects.map(a => `How do competitors compare on ${a}?`),
    ];

    return this.conductResearch(
      {
        ...dispatch,
        input: {
          ...dispatch.input,
          topic,
          questions,
          depth: 'deep',
        },
      },
      context
    );
  }

  /**
   * Fact check claims with sources
   */
  private async factCheck(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const claims = dispatch.input.claims as string[] || [];

    if (claims.length === 0) {
      return {
        success: false,
        error: {
          code: 'NO_CLAIMS',
          message: 'No claims provided for fact checking',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(10, 'Preparing to verify claims');

    const systemPrompt = this.buildSystemPrompt(context) + `

You are fact-checking the following claims. For each claim:
1. Search for supporting or contradicting evidence
2. Rate confidence: high (verified by 3+ reliable sources), medium (1-2 sources), low (no clear sources)
3. Note any nuances or caveats
4. Mark speculation clearly`;

    const results: Array<{
      claim: string;
      verified: boolean;
      confidence: 'high' | 'medium' | 'low';
      evidence: string;
      sources: Source[];
    }> = [];

    let totalTokens = 0;
    let totalCost = 0;

    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i]!;
      context.reportProgress(20 + (i / claims.length) * 60, `Verifying claim ${i + 1}/${claims.length}`);

      // Search for evidence
      const searchResults = await this.performSearch(claim, 'quick');

      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Fact check this claim: "${claim}"

Available sources:
${searchResults.map(s => `- ${s.title}: ${s.url}`).join('\n')}

Determine if this claim is supported, contradicted, or unclear based on available evidence.`,
        },
      ];

      const response = await this.llm.complete(messages, {
        maxTokens: 500,
        temperature: 0.2,
      });

      totalTokens += response.usage.totalTokens;
      totalCost += response.cost;

      // Parse verification result
      const verified = response.content.toLowerCase().includes('verified') ||
        response.content.toLowerCase().includes('supported');
      const confidence = this.extractConfidence(response.content);

      results.push({
        claim,
        verified,
        confidence,
        evidence: response.content,
        sources: searchResults.slice(0, 3),
      });
    }

    context.reportProgress(90, 'Compiling fact check report');

    return {
      success: true,
      output: {
        type: 'fact_check_report',
        results,
        summary: {
          total: claims.length,
          verified: results.filter(r => r.verified).length,
          highConfidence: results.filter(r => r.confidence === 'high').length,
        },
      },
      usage: {
        tokens: totalTokens,
        cost: totalCost,
      },
    };
  }

  /**
   * Summarize information
   */
  private async summarizeInformation(
    dispatch: TaskDispatch,
    _context: AgentContext
  ): Promise<ExecutionResult> {
    const content = dispatch.input.content as string || '';
    const format = dispatch.input.format as 'bullet' | 'paragraph' | 'executive' || 'bullet';
    const maxLength = dispatch.input.maxLength as number || 500;

    if (!content) {
      return {
        success: false,
        error: {
          code: 'NO_CONTENT',
          message: 'No content provided for summarization',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    const formatInstructions = {
      bullet: 'Use bullet points for key points',
      paragraph: 'Write a concise paragraph',
      executive: 'Write an executive summary with headline, key points, and conclusion',
    };

    const systemPrompt = `You are a research analyst summarizing information.
${formatInstructions[format]}
Keep the summary under ${maxLength} words.
Focus on the most important information.
Maintain factual accuracy.`;

    const response = await this.llm.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Summarize the following:\n\n${content}` },
      ],
      { maxTokens: maxLength * 2, temperature: 0.3 }
    );

    return {
      success: true,
      output: {
        type: 'summary',
        format,
        content: response.content,
        originalLength: content.length,
        summaryLength: response.content.length,
      },
      usage: {
        tokens: response.usage.totalTokens,
        cost: response.cost,
      },
    };
  }

  /**
   * Perform web search
   */
  private async performSearch(query: string, depth: 'quick' | 'standard' | 'deep'): Promise<Source[]> {
    const maxResults = depth === 'quick' ? 3 : depth === 'standard' ? 5 : 10;

    // Try real search API if available
    if (this.searchApiKey) {
      try {
        return await this.realSearch(query, maxResults);
      } catch (error) {
        logger.warn({ error }, 'Real search failed, using simulated results');
      }
    }

    // Simulated search results for development
    return this.simulatedSearch(query, maxResults);
  }

  /**
   * Real search using Serper API (or similar)
   */
  private async realSearch(query: string, maxResults: number): Promise<Source[]> {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': this.searchApiKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: maxResults,
      }),
    });

    if (!response.ok) {
      throw new Error(`Search API error: ${response.status}`);
    }

    const data = await response.json() as {
      organic: Array<{
        title: string;
        link: string;
        snippet?: string;
        date?: string;
      }>;
    };

    return (data.organic || []).map(result => ({
      title: result.title,
      url: result.link,
      publishDate: result.date,
      credibility: 'medium' as const,
    }));
  }

  /**
   * Simulated search for development
   */
  private simulatedSearch(query: string, maxResults: number): Source[] {
    const keywords = query.toLowerCase().split(' ');

    // Generate plausible mock sources
    const sources: Source[] = [];

    const domains = ['example.com', 'research.org', 'industry-report.com', 'marketwatch.com', 'techcrunch.com'];
    const types = ['Report', 'Analysis', 'Study', 'Overview', 'Guide'];

    for (let i = 0; i < maxResults; i++) {
      const domain = domains[i % domains.length]!;
      const type = types[i % types.length]!;
      const keyword = keywords[i % keywords.length] || 'topic';

      sources.push({
        title: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} ${type} ${2024 + i}`,
        url: `https://${domain}/${keyword.replace(/\s+/g, '-')}-${type.toLowerCase()}`,
        publishDate: new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        credibility: i < 2 ? 'high' : i < 4 ? 'medium' : 'low',
      });
    }

    return sources;
  }

  /**
   * Build system prompt based on agent personality
   */
  private buildSystemPrompt(context: AgentContext): string {
    const personality = context.personality || {};
    const rules = context.operatingRules || [];

    let prompt = `You are a Research Agent responsible for gathering and analyzing information.

Your approach is ${personality.style || 'analytical'} and your communication is ${personality.communication || 'concise'}.
You make decisions based on ${personality.decision_making || 'data-driven'} analysis.

Core principles:
1. Always cite sources with URLs
2. Provide confidence levels (high/medium/low) for all findings
3. Cross-reference multiple sources for key claims
4. Distinguish facts from speculation
5. Note when data may be stale (>30 days old)`;

    if (rules.length > 0) {
      prompt += `\n\nOperating Rules (MUST follow):`;
      rules.forEach((rule, i) => {
        prompt += `\n${i + 1}. ${rule}`;
      });
    }

    return prompt;
  }

  /**
   * Build research prompt
   */
  private buildResearchPrompt(topic: string, questions: string[], sources: Source[]): string {
    let prompt = `Research topic: ${topic}`;

    if (questions.length > 0) {
      prompt += `\n\nSpecific questions to answer:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
    }

    prompt += `\n\nAvailable sources:\n${sources.map(s => `- ${s.title} (${s.url})${s.publishDate ? ` - ${s.publishDate}` : ''}`).join('\n')}`;

    prompt += `\n\nUse the report_findings tool to structure your findings with:
1. Executive summary
2. Key findings with confidence levels
3. Sources for each claim
4. Limitations and recommendations`;

    return prompt;
  }

  /**
   * Parse research from text
   */
  private parseResearchFromText(text: string, sources: Source[]): ResearchResult | null {
    // Simple parsing - extract what we can
    const lines = text.split('\n').filter(l => l.trim());

    // Try to find summary (first paragraph or section)
    let summary = '';
    const findings: Finding[] = [];

    let inFindings = false;
    for (const line of lines) {
      if (line.toLowerCase().includes('summary') || (!summary && !inFindings)) {
        summary = line.replace(/^#+\s*summary:?\s*/i, '').trim();
        if (summary.length > 20) continue; // Use this as summary
      }

      if (line.toLowerCase().includes('finding') || line.match(/^\d+\./)) {
        inFindings = true;
      }

      if (inFindings && line.match(/^[\d\-\*]\s*\.?\s*.+/)) {
        const claim = line.replace(/^[\d\-\*]\s*\.?\s*/, '').trim();
        if (claim.length > 10) {
          findings.push({
            claim,
            confidence: this.extractConfidence(claim) || 'medium',
            sources: sources.slice(0, 2),
          });
        }
      }
    }

    if (!summary && findings.length === 0) {
      // Use whole text as summary if we couldn't parse
      return {
        summary: text.slice(0, 500),
        findings: [{
          claim: text.slice(0, 200),
          confidence: 'low',
          sources: sources.slice(0, 2),
          notes: 'Extracted from unstructured response',
        }],
        rawSources: sources,
      };
    }

    return {
      summary: summary || `Research on topic with ${findings.length} findings`,
      findings,
      rawSources: sources,
    };
  }

  /**
   * Extract confidence level from text
   */
  private extractConfidence(text: string): 'high' | 'medium' | 'low' {
    const lower = text.toLowerCase();
    if (lower.includes('high confidence') || lower.includes('confirmed') || lower.includes('verified')) {
      return 'high';
    }
    if (lower.includes('low confidence') || lower.includes('unclear') || lower.includes('uncertain')) {
      return 'low';
    }
    return 'medium';
  }
}

// Export singleton
export const researchAgent = new ResearchAgent();
