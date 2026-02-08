import pino from 'pino';

import { BaseAgent, type AgentContext, type ExecutionResult, type TaskDispatch } from '../executor/base-agent.js';
import { LLMClient, type LLMMessage, type ToolDefinition } from '../executor/llm-client.js';

const logger = pino({ name: 'agent-marketing' });

/**
 * Copy variant for A/B testing
 */
interface CopyVariant {
  id: string;
  headline: string;
  subheadline?: string;
  body: string;
  cta: string;
  targetAudience?: string;
  tone?: string;
}

/**
 * Landing page section
 */
interface LandingPageSection {
  type: 'hero' | 'features' | 'benefits' | 'testimonials' | 'cta' | 'faq';
  headline: string;
  content: string;
  items?: Array<{
    title: string;
    description: string;
    icon?: string;
  }>;
}

/**
 * Marketing output types
 */
interface MarketingOutput {
  type: 'copy' | 'landing_page' | 'email' | 'social';
  variants?: CopyVariant[];
  sections?: LandingPageSection[];
  brandVoice?: string;
  targetAudience?: string;
}

/**
 * Marketing Agent Tools
 */
const MARKETING_TOOLS: ToolDefinition[] = [
  {
    name: 'generate_copy',
    description: 'Generate marketing copy with A/B variants',
    parameters: {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          description: 'Copy variants for A/B testing (2-3 variants)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Variant identifier (A, B, C)' },
              headline: { type: 'string', description: 'Main headline' },
              subheadline: { type: 'string', description: 'Supporting subheadline' },
              body: { type: 'string', description: 'Body copy' },
              cta: { type: 'string', description: 'Call-to-action text' },
              targetAudience: { type: 'string', description: 'Target audience for this variant' },
              tone: { type: 'string', description: 'Tone/voice used' },
            },
            required: ['id', 'headline', 'body', 'cta'],
          },
        },
        rationale: {
          type: 'string',
          description: 'Explanation of variant differences and testing hypothesis',
        },
      },
      required: ['variants', 'rationale'],
    },
  },
  {
    name: 'generate_landing_page',
    description: 'Generate landing page content with sections',
    parameters: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          description: 'Landing page sections in order',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Section type',
                enum: ['hero', 'features', 'benefits', 'testimonials', 'cta', 'faq'],
              },
              headline: { type: 'string', description: 'Section headline' },
              content: { type: 'string', description: 'Section main content' },
              items: {
                type: 'array',
                description: 'List items for features/benefits/faq',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['title', 'description'],
                },
              },
            },
            required: ['type', 'headline', 'content'],
          },
        },
        pageTitle: {
          type: 'string',
          description: 'Page title for SEO',
        },
        metaDescription: {
          type: 'string',
          description: 'Meta description for SEO',
        },
      },
      required: ['sections'],
    },
  },
  {
    name: 'request_brand_guidelines',
    description: 'Request brand guidelines if not provided',
    parameters: {
      type: 'object',
      properties: {
        needed: {
          type: 'array',
          description: 'List of brand elements needed',
          items: { type: 'string' },
        },
        reason: {
          type: 'string',
          description: 'Why these guidelines are needed',
        },
      },
      required: ['needed', 'reason'],
    },
  },
];

/**
 * Marketing Agent
 *
 * Responsibilities:
 * - Copy generation: Headlines, body copy, CTAs
 * - Landing page content: Structured sections
 * - Brand voice consistency: Following guidelines
 * - A/B variant generation: Multiple options for testing
 */
export class MarketingAgent extends BaseAgent {
  private llm: LLMClient;

  constructor(agentId: string = 'agent:marketing') {
    super(agentId, 'marketing', 'marketing');
    this.llm = new LLMClient();
  }

  getCapabilities() {
    return [
      { id: 'skill:copywriting', version: '1.0', tags: ['content', 'marketing'] },
      { id: 'skill:landing-pages', version: '1.0', tags: ['content', 'web'] },
      { id: 'skill:brand-voice', version: '1.0', tags: ['branding'] },
      { id: 'skill:ab-testing', version: '1.0', tags: ['optimization'] },
    ];
  }

  getAvailableActions() {
    return [
      'copy',            // Generate marketing copy
      'landing_page',    // Create landing page content
      'email',           // Create email copy
      'social',          // Create social media posts
      'headline',        // Generate headlines only
      'cta',             // Generate CTAs only
    ];
  }

  protected async executeTask(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const action = dispatch.action || 'copy';

    switch (action) {
      case 'copy':
        return this.generateCopy(dispatch, context);

      case 'landing_page':
        return this.generateLandingPage(dispatch, context);

      case 'email':
        return this.generateEmail(dispatch, context);

      case 'social':
        return this.generateSocialPosts(dispatch, context);

      case 'headline':
        return this.generateHeadlines(dispatch, context);

      default:
        return this.generateCopy(dispatch, context);
    }
  }

  /**
   * Generate marketing copy with A/B variants
   */
  private async generateCopy(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const product = dispatch.input.product as string || dispatch.input.title as string || '';
    const valueProposition = dispatch.input.valueProposition as string || '';
    const targetAudience = dispatch.input.targetAudience as string || '';
    const brandGuidelines = dispatch.input.brandGuidelines as Record<string, unknown> || {};
    const tone = dispatch.input.tone as string || 'professional';
    const researchContext = dispatch.input.research as string || '';

    if (!product) {
      return {
        success: false,
        error: {
          code: 'MISSING_PRODUCT',
          message: 'Product or service name is required',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(10, 'Analyzing product and audience');

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(context, brandGuidelines);

    // Build copy prompt
    const userPrompt = this.buildCopyPrompt(product, valueProposition, targetAudience, tone, researchContext);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // Add working memory
    if (context.workingMemory) {
      messages.push({
        role: 'user',
        content: `Previous work context:\n${context.workingMemory}`,
      });
    }

    context.reportProgress(30, 'Generating copy variants');

    try {
      const response = await this.llm.completeWithTools(messages, MARKETING_TOOLS, {
        maxTokens: 2500,
        temperature: 0.7, // Higher for creativity
      });

      context.emitToolCall('llm.complete', { product, targetAudience }, response);

      context.reportProgress(70, 'Processing variants');

      // Extract copy from tool calls
      let output: MarketingOutput | null = null;

      if (response.toolCalls?.length) {
        const copyCall = response.toolCalls.find(tc => tc.name === 'generate_copy');
        const guidelinesCall = response.toolCalls.find(tc => tc.name === 'request_brand_guidelines');

        if (guidelinesCall) {
          // Agent needs brand guidelines
          return {
            success: false,
            error: {
              code: 'NEED_BRAND_GUIDELINES',
              message: `Brand guidelines needed: ${(guidelinesCall.arguments.needed as string[]).join(', ')}`,
              retryable: true,
            },
            output: guidelinesCall.arguments,
            usage: {
              tokens: response.usage.totalTokens,
              cost: response.cost,
            },
          };
        }

        if (copyCall) {
          output = {
            type: 'copy',
            variants: copyCall.arguments.variants as CopyVariant[],
            brandVoice: tone,
            targetAudience,
          };
        }
      }

      // Fallback: parse from text
      if (!output) {
        output = this.parseCopyFromText(response.content);
      }

      if (!output || !output.variants?.length) {
        return {
          success: false,
          error: {
            code: 'GENERATION_FAILED',
            message: 'Failed to generate copy variants',
            retryable: true,
          },
          usage: {
            tokens: response.usage.totalTokens,
            cost: response.cost,
          },
        };
      }

      context.reportProgress(90, 'Finalizing copy');

      return {
        success: true,
        output: {
          ...output,
          metadata: {
            product,
            variantCount: output.variants.length,
            targetAudience,
          },
        },
        memoryUpdates: {
          workingNotes: `Generated ${output.variants.length} copy variants for "${product}"`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Copy generation failed');
      return {
        success: false,
        error: {
          code: 'COPY_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Generate landing page content
   */
  private async generateLandingPage(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const product = dispatch.input.product as string || dispatch.input.title as string || '';
    const valueProposition = dispatch.input.valueProposition as string || '';
    const targetAudience = dispatch.input.targetAudience as string || '';
    const features = dispatch.input.features as string[] || [];
    const brandGuidelines = dispatch.input.brandGuidelines as Record<string, unknown> || {};

    if (!product) {
      return {
        success: false,
        error: {
          code: 'MISSING_PRODUCT',
          message: 'Product name is required for landing page',
          retryable: false,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }

    context.reportProgress(10, 'Planning landing page structure');

    const systemPrompt = this.buildSystemPrompt(context, brandGuidelines);

    const userPrompt = `Create compelling landing page content for:

Product: ${product}
Value Proposition: ${valueProposition || 'To be determined based on features'}
Target Audience: ${targetAudience || 'General audience'}
${features.length > 0 ? `Key Features:\n${features.map(f => `- ${f}`).join('\n')}` : ''}

Generate a complete landing page with these sections:
1. Hero section - Attention-grabbing headline and value proposition
2. Features section - 3-5 key features with benefits
3. Benefits section - Why choose this product
4. Social proof/testimonials section
5. CTA section - Clear call to action
6. FAQ section - Common questions

Use the generate_landing_page tool to structure your output.
Ensure copy is compelling, benefit-focused, and action-oriented.`;

    context.reportProgress(30, 'Generating landing page content');

    try {
      const response = await this.llm.completeWithTools(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        MARKETING_TOOLS,
        { maxTokens: 3500, temperature: 0.6 }
      );

      context.emitToolCall('llm.complete', { product, features }, response);

      context.reportProgress(70, 'Structuring page sections');

      let output: MarketingOutput | null = null;

      if (response.toolCalls?.length) {
        const pageCall = response.toolCalls.find(tc => tc.name === 'generate_landing_page');
        if (pageCall) {
          output = {
            type: 'landing_page',
            sections: pageCall.arguments.sections as LandingPageSection[],
            targetAudience,
          };
        }
      }

      if (!output) {
        output = this.parseLandingPageFromText(response.content);
      }

      if (!output || !output.sections?.length) {
        return {
          success: false,
          error: {
            code: 'GENERATION_FAILED',
            message: 'Failed to generate landing page content',
            retryable: true,
          },
          usage: {
            tokens: response.usage.totalTokens,
            cost: response.cost,
          },
        };
      }

      return {
        success: true,
        output: {
          ...output,
          metadata: {
            product,
            sectionCount: output.sections.length,
          },
        },
        memoryUpdates: {
          workingNotes: `Created landing page with ${output.sections.length} sections for "${product}"`,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Landing page generation failed');
      return {
        success: false,
        error: {
          code: 'LANDING_PAGE_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Generate email copy
   */
  private async generateEmail(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const subject = dispatch.input.subject as string || '';
    const purpose = dispatch.input.purpose as string || 'promotion';
    const product = dispatch.input.product as string || '';
    const targetAudience = dispatch.input.targetAudience as string || '';

    context.reportProgress(20, 'Generating email copy');

    const systemPrompt = this.buildSystemPrompt(context, {});

    const userPrompt = `Create email marketing copy:

Purpose: ${purpose}
${subject ? `Subject line idea: ${subject}` : ''}
Product/Service: ${product}
Target Audience: ${targetAudience}

Generate 2-3 email variants with:
1. Subject line (compelling, under 50 chars)
2. Preview text (under 100 chars)
3. Body copy (with clear sections)
4. CTA button text

Use the generate_copy tool with email-appropriate structure.`;

    try {
      const response = await this.llm.completeWithTools(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        MARKETING_TOOLS,
        { maxTokens: 2000, temperature: 0.7 }
      );

      context.reportProgress(80, 'Formatting email variants');

      let variants: CopyVariant[] = [];

      if (response.toolCalls?.length) {
        const copyCall = response.toolCalls.find(tc => tc.name === 'generate_copy');
        if (copyCall) {
          variants = copyCall.arguments.variants as CopyVariant[];
        }
      }

      if (!variants.length) {
        variants = this.parseEmailFromText(response.content);
      }

      return {
        success: true,
        output: {
          type: 'email',
          variants,
          targetAudience,
          metadata: { purpose, variantCount: variants.length },
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'EMAIL_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Generate social media posts
   */
  private async generateSocialPosts(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult> {
    const content = dispatch.input.content as string || dispatch.input.topic as string || '';
    const platforms = dispatch.input.platforms as string[] || ['twitter', 'linkedin'];
    const tone = dispatch.input.tone as string || 'professional';

    context.reportProgress(20, 'Generating social posts');

    const systemPrompt = this.buildSystemPrompt(context, {}) + `

Platform-specific guidelines:
- Twitter/X: 280 chars max, punchy, hashtags
- LinkedIn: Professional, longer form OK, thought leadership
- Instagram: Visual-first, 2200 char max, hashtag strategy
- Facebook: Conversational, can be longer`;

    const userPrompt = `Create social media posts for: ${content}

Platforms: ${platforms.join(', ')}
Tone: ${tone}

Generate 2-3 variants per platform, optimized for each platform's best practices.`;

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { maxTokens: 1500, temperature: 0.8 }
      );

      return {
        success: true,
        output: {
          type: 'social',
          content: response.content,
          platforms,
          metadata: { topic: content, tone },
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SOCIAL_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Generate headlines only
   */
  private async generateHeadlines(
    dispatch: TaskDispatch,
    _context: AgentContext
  ): Promise<ExecutionResult> {
    const topic = dispatch.input.topic as string || dispatch.input.product as string || '';
    const count = dispatch.input.count as number || 5;
    const style = dispatch.input.style as string || 'benefit-focused';

    const systemPrompt = `You are an expert headline writer. Generate compelling headlines that:
- Grab attention immediately
- Communicate clear value
- Use power words appropriately
- Match the requested style`;

    const userPrompt = `Generate ${count} headlines for: ${topic}

Style: ${style}
Provide varied approaches (question, number, how-to, benefit, etc.)`;

    try {
      const response = await this.llm.complete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { maxTokens: 500, temperature: 0.9 }
      );

      const headlines = response.content
        .split('\n')
        .filter(l => l.trim())
        .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(l => l.length > 5);

      return {
        success: true,
        output: {
          type: 'headlines',
          headlines,
          topic,
          style,
        },
        usage: {
          tokens: response.usage.totalTokens,
          cost: response.cost,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'HEADLINE_FAILED',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { tokens: 0, cost: 0 },
      };
    }
  }

  /**
   * Build system prompt with brand guidelines
   */
  private buildSystemPrompt(context: AgentContext, brandGuidelines: Record<string, unknown>): string {
    const personality = context.personality || {};
    const rules = context.operatingRules || [];

    let prompt = `You are a Marketing Agent creating compelling copy and content.

Your style is ${personality.style || 'creative'} with ${personality.communication || 'verbose'} communication.
You make decisions ${personality.decision_making || 'intuitively'}.

Core principles:
1. Always focus on benefits, not just features
2. Use clear, action-oriented CTAs
3. Match the target audience's language and concerns
4. Create 2-3 variants for A/B testing
5. Never make unsupported claims`;

    if (Object.keys(brandGuidelines).length > 0) {
      prompt += `\n\nBrand Guidelines:`;
      for (const [key, value] of Object.entries(brandGuidelines)) {
        prompt += `\n- ${key}: ${JSON.stringify(value)}`;
      }
    }

    if (rules.length > 0) {
      prompt += `\n\nOperating Rules (MUST follow):`;
      rules.forEach((rule, i) => {
        prompt += `\n${i + 1}. ${rule}`;
      });
    }

    return prompt;
  }

  /**
   * Build copy generation prompt
   */
  private buildCopyPrompt(
    product: string,
    valueProposition: string,
    targetAudience: string,
    tone: string,
    researchContext: string
  ): string {
    let prompt = `Generate marketing copy for:

Product/Service: ${product}
${valueProposition ? `Value Proposition: ${valueProposition}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}
Tone: ${tone}`;

    if (researchContext) {
      prompt += `\n\nResearch Context:\n${researchContext}`;
    }

    prompt += `

Create 2-3 copy variants using the generate_copy tool.
Each variant should have:
- Compelling headline
- Supporting subheadline (optional)
- Benefit-focused body copy
- Clear, action-oriented CTA

Vary the approach:
- Variant A: Direct/benefit-focused
- Variant B: Problem/solution
- Variant C: Social proof/FOMO (if applicable)`;

    return prompt;
  }

  /**
   * Parse copy from text response
   */
  private parseCopyFromText(text: string): MarketingOutput | null {
    const variants: CopyVariant[] = [];
    const sections = text.split(/variant\s*[abc][:.\s]/i).filter(s => s.trim());

    sections.forEach((section, i) => {
      const lines = section.split('\n').filter(l => l.trim());

      // Try to extract headline, body, cta
      let headline = '';
      let body = '';
      let cta = '';

      for (const line of lines) {
        if (line.toLowerCase().includes('headline') || (!headline && line.length < 100)) {
          headline = line.replace(/^[^:]+:\s*/, '').trim();
        } else if (line.toLowerCase().includes('cta') || line.toLowerCase().includes('call')) {
          cta = line.replace(/^[^:]+:\s*/, '').trim();
        } else if (line.length > 20) {
          body += line + ' ';
        }
      }

      if (headline || body) {
        variants.push({
          id: String.fromCharCode(65 + i), // A, B, C
          headline: headline || body.slice(0, 50),
          body: body.trim() || headline,
          cta: cta || 'Learn More',
        });
      }
    });

    if (variants.length === 0) return null;

    return { type: 'copy', variants };
  }

  /**
   * Parse landing page from text
   */
  private parseLandingPageFromText(text: string): MarketingOutput | null {
    const sections: LandingPageSection[] = [];
    const sectionMatches = text.split(/#{1,3}\s+/);

    const typeMap: Record<string, LandingPageSection['type']> = {
      hero: 'hero',
      feature: 'features',
      benefit: 'benefits',
      testimonial: 'testimonials',
      cta: 'cta',
      faq: 'faq',
    };

    for (const section of sectionMatches) {
      if (!section.trim()) continue;

      const lines = section.split('\n').filter(l => l.trim());
      const headlineMatch = lines[0];

      if (!headlineMatch) continue;

      let type: LandingPageSection['type'] = 'features';
      for (const [key, val] of Object.entries(typeMap)) {
        if (headlineMatch.toLowerCase().includes(key)) {
          type = val;
          break;
        }
      }

      sections.push({
        type,
        headline: headlineMatch.trim(),
        content: lines.slice(1).join('\n').trim() || headlineMatch,
      });
    }

    if (sections.length === 0) return null;

    return { type: 'landing_page', sections };
  }

  /**
   * Parse email from text
   */
  private parseEmailFromText(text: string): CopyVariant[] {
    const variants: CopyVariant[] = [];
    const emailSections = text.split(/variant\s*[abc][:.\s]|email\s*\d/i).filter(s => s.trim());

    emailSections.forEach((section, i) => {
      const lines = section.split('\n').filter(l => l.trim());

      let headline = ''; // subject line
      let body = '';
      let cta = '';

      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes('subject')) {
          headline = line.replace(/^[^:]+:\s*/, '').trim();
        } else if (lower.includes('cta') || lower.includes('button')) {
          cta = line.replace(/^[^:]+:\s*/, '').trim();
        } else if (line.length > 20) {
          body += line + '\n';
        }
      }

      if (headline || body) {
        variants.push({
          id: String.fromCharCode(65 + i),
          headline: headline || 'Check this out',
          body: body.trim(),
          cta: cta || 'Click Here',
        });
      }
    });

    return variants;
  }
}

// Export singleton
export const marketingAgent = new MarketingAgent();
