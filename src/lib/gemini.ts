const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash';

type AiQuestionInput = {
  id: number;
  prompt: string;
};

type AiAnswerOutput = {
  id: number;
  answer: string;
};

type GeminiPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

function extractJsonPayload(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return text.trim();
}

function normalizeAiAnswers(payload: unknown) {
  const rawAnswers = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { answers?: unknown[] }).answers)
    ? (payload as { answers: unknown[] }).answers
    : [];

  return rawAnswers
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const { id, answer } = entry as Partial<AiAnswerOutput>;

      if (typeof id !== 'number' || typeof answer !== 'string') {
        return null;
      }

      return {
        id,
        answer: answer.trim()
      };
    })
    .filter((entry): entry is AiAnswerOutput => entry !== null);
}

export async function generateAnswersWithGemini(questions: AiQuestionInput[]) {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing VITE_GEMINI_API_KEY in the app environment.');
  }

  const prompt = [
    'Infer the best answer for each quiz item.',
    'Rules:',
    '1. Return JSON only.',
    '2. If the item is multiple choice, answer with the single choice label only, like A or B.',
    '3. If the item is open-ended, answer with the shortest correct answer text.',
    '4. If the answer cannot be inferred confidently, return an empty string.',
    '5. Preserve the same id values.',
    '',
    'Questions:',
    JSON.stringify(questions, null, 2)
  ].join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Gemini request failed');
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();

  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJsonPayload(text));
  } catch {
    throw new Error('Gemini returned a response that was not valid JSON.');
  }

  return normalizeAiAnswers(parsed);
}
