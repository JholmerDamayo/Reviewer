const SUPABASE_URL = 'https://ixruzsfjguseeyvdfjne.supabase.co/rest/v1';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4cnV6c2ZqZ3VzZWV5dmRmam5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MzcwNjIsImV4cCI6MjA5MzAxMzA2Mn0.83ndKVsfs8_vFk_q-Kl4QMpT9iVCHlcQUFyS3IYfW6o';

export type StudentAccount = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  initials: string;
};

export type PracticeQuestionRecord = {
  id: number;
  prompt: string;
  answer: string;
};

export type PracticeQuizRecord = {
  id: number;
  itemCount: number;
  sourceText: string;
  questions: PracticeQuestionRecord[];
  attempts: number;
  lastScore: number;
  lastAccuracy: number;
  lastAnalysis: string;
  lastResponses?: Record<number, string>;
};

export type PracticeWorkspace = {
  id: string;
  student_account_id: string;
  title: string;
  quiz_count: number;
  quizzes: PracticeQuizRecord[];
  created_at: string;
  updated_at: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  prefer?: string;
};

async function supabaseRequest<T>(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${SUPABASE_URL}/${path}`, {
    method: options.method ?? 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Supabase request failed');
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export async function getStudentAccountByCredentials(username: string, password: string) {
  const params = new URLSearchParams({
    select: 'id,username,display_name,role,initials',
    username: `eq.${username.trim()}`,
    password: `eq.${password}`,
    limit: '1'
  });

  const rows = await supabaseRequest<StudentAccount[]>(
    `student_accounts?${params.toString()}`
  );

  return rows[0] ?? null;
}

export async function getPracticeWorkspace(studentAccountId: string) {
  const params = new URLSearchParams({
    select: '*',
    student_account_id: `eq.${studentAccountId}`,
    limit: '1'
  });

  const rows = await supabaseRequest<PracticeWorkspace[]>(
    `practice_workspaces?${params.toString()}`
  );

  return rows[0] ?? null;
}

export async function upsertPracticeWorkspace(input: {
  studentAccountId: string;
  title: string;
  quizCount: number;
  quizzes: PracticeQuizRecord[];
}) {
  const params = new URLSearchParams({
    on_conflict: 'student_account_id'
  });

  const rows = await supabaseRequest<PracticeWorkspace[]>(
    `practice_workspaces?${params.toString()}`,
    {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: [
        {
          student_account_id: input.studentAccountId,
          title: input.title,
          quiz_count: input.quizCount,
          quizzes: input.quizzes
        }
      ]
    }
  );

  return rows[0] ?? null;
}
