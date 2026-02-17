import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export interface SpeciesInfoRequest {
  speciesName: string;
}

export interface SpeciesInfoResponse {
  info: string;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { speciesName } = body as SpeciesInfoRequest;

    // Initialize OpenAI client only when route is called (not at module load time)
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    if (!speciesName || typeof speciesName !== 'string') {
      return NextResponse.json(
        { error: 'Species name is required' },
        { status: 400 }
      );
    }

    logger.info('Fetching species information', {
      context: 'species-info-api',
      data: { speciesName }
    });

    // Create AI prompt for species information
    const systemPrompt = `You are a marine biology expert. When given a species name, provide concise, factual information about the species.

Include the following details (if available):
- Common name(s)
- Taxonomic classification (Kingdom, Phylum, Class, Order, Family, Genus, Species)
- Brief description (habitat, appearance, behavior)
- Geographic distribution
- Conservation status (if notable)

Format your response as a clear, readable paragraph or bullet points. Be concise but informative.
If the species name is misspelled or not found, suggest the correct spelling or closest match.`;

    const userPrompt = `Provide information about the species: ${speciesName}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cost-efficient for info retrieval
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more factual responses
      max_tokens: 500,
    });

    const info = response.choices[0]?.message?.content?.trim() || 'No information available';

    logger.info('Species information fetched successfully', {
      context: 'species-info-api',
      data: {
        speciesName,
        infoLength: info.length,
        tokensUsed: response.usage?.total_tokens
      }
    });

    return NextResponse.json({
      info,
      tokensUsed: response.usage?.total_tokens
    } as SpeciesInfoResponse);

  } catch (error) {
    logger.error('Error fetching species information', error as Error, {
      context: 'species-info-api'
    });

    return NextResponse.json(
      {
        error: 'Failed to fetch species information',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
