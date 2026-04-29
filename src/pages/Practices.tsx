import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent
} from 'react';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { getPracticeWorkspace, upsertPracticeWorkspace } from '../lib/supabase';
import { extractTextFromQuestionFile } from '../utils/fileTextExtraction';

type QuestionEntry = {
  id: number;
  prompt: string;
  answer: string;
};

type QuizInstance = {
  id: number;
  itemCount: number;
  sourceText: string;
  questions: QuestionEntry[];
  attempts: number;
  lastScore: number;
  lastAccuracy: number;
  lastAnalysis: string;
  lastResponses: Record<number, string>;
};

type ParsedChoice = {
  label: string;
  text: string;
};

type QuizResultSummary = {
  accuracy: number;
  attempt: number;
  score: number;
  total: number;
  analysis: string;
};

type AnswerAssistMode = 'manual' | 'ai';
type AnswerAssistStep = 'select' | 'reminder';
type AnswerAssistTrigger = 'scan' | 'save';

function createDefaultQuestions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    prompt: `Question ${index + 1}`,
    answer: ''
  }));
}

function createQuizInstances(
  count: number,
  previous: Array<Partial<QuizInstance>> = []
) {
  return Array.from({ length: count }, (_, index) => {
    const previousQuiz = previous[index];
    const nextCount = previousQuiz?.itemCount ?? 10;

    return {
      id: index + 1,
      itemCount: nextCount,
      sourceText: previousQuiz?.sourceText ?? '',
      attempts: previousQuiz?.attempts ?? 0,
      lastScore: previousQuiz?.lastScore ?? 0,
      lastAccuracy: previousQuiz?.lastAccuracy ?? 0,
      lastAnalysis: previousQuiz?.lastAnalysis ?? '',
      lastResponses: previousQuiz?.lastResponses ?? {},
      questions: previousQuiz?.questions?.length
        ? previousQuiz.questions
        : createDefaultQuestions(nextCount)
    };
  });
}

function normalizeQuestionBlocks(text: string) {
  const numberedBlocks = Array.from(
    text.matchAll(/(?:^|\n)\s*(\d+)\.\s*([\s\S]*?)(?=\n\s*\d+\.\s|\s*$)/g)
  ).map((match) => `${match[1]}. ${match[2].trim()}`.trim());

  if (numberedBlocks.length) {
    return numberedBlocks;
  }

  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function createQuestionsFromSource(text: string, limit: number) {
  const lines = text.split(/\r?\n/);
  const answersHeaderIndex = lines.findIndex((line) => /^answers\s*:?$/i.test(line.trim()));
  const answerMap = new Map<number, string>();
  const inlineAnswersMatch = text.match(/answers\s*:\s*([\s\S]*)$/i);

  let questionSourceText = text;

  if (answersHeaderIndex >= 0) {
    const answerLines = lines.slice(answersHeaderIndex + 1);

    answerLines.forEach((line) => {
      const match = line.trim().match(/^(\d+)\.\s*(.+)$/);

      if (match) {
        answerMap.set(Number(match[1]), match[2].trim());
      }
    });

    questionSourceText = lines.slice(0, answersHeaderIndex).join('\n').trim();
  } else if (inlineAnswersMatch) {
    const answerSection = inlineAnswersMatch[1];
    const answerMatches = Array.from(answerSection.matchAll(/(\d+)\.\s*([A-Za-z]+)/g));

    answerMatches.forEach((match) => {
      answerMap.set(Number(match[1]), match[2].trim());
    });

    questionSourceText = text.slice(0, inlineAnswersMatch.index).trim();
  }

  const questionBlocks = normalizeQuestionBlocks(questionSourceText);

  return {
    totalDetected: questionBlocks.length,
    questions: questionBlocks.slice(0, limit).map((block, index) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trimEnd());
      const answerLineIndex = lines.findIndex((line) =>
        /^answer\s*[:=]\s*/i.test(line.trim())
      );

      let extractedAnswer = '';
      let promptLines = lines;

      if (answerLineIndex >= 0) {
        const answerLine = lines[answerLineIndex].trim();
        extractedAnswer = answerLine.replace(/^answer\s*[:=]\s*/i, '').trim();
        promptLines = lines.filter((_, currentIndex) => currentIndex !== answerLineIndex);
      }

      return {
        id: index + 1,
        prompt: promptLines.join('\n').trim(),
        answer: extractedAnswer || answerMap.get(index + 1) || ''
      };
    })
  };
}

function buildQuestionDrafts(
  count: number,
  scannedQuestions: QuestionEntry[] = [],
  previousQuestions: QuestionEntry[] = []
) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    prompt:
      scannedQuestions[index]?.prompt ??
      previousQuestions[index]?.prompt ??
      `Question ${index + 1}`,
    answer:
      scannedQuestions[index]?.answer ??
      previousQuestions[index]?.answer ??
      ''
  }));
}

function buildScannedQuestionDrafts(
  count: number,
  scannedQuestions: QuestionEntry[],
  previousQuestions: QuestionEntry[] = []
) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    prompt:
      scannedQuestions[index]?.prompt ??
      previousQuestions[index]?.prompt ??
      `Question ${index + 1}`,
    answer:
      scannedQuestions[index] !== undefined
        ? scannedQuestions[index].answer
        : previousQuestions[index]?.answer ?? ''
  }));
}

function isPlaceholderQuestion(prompt: string) {
  return /^Question\s+\d+$/i.test(prompt.trim());
}

function hasSavedQuizContent(quiz: QuizInstance) {
  return quiz.questions.some(
    (question) =>
      question.answer.trim().length > 0 || !isPlaceholderQuestion(question.prompt)
  );
}

function parsePromptChoices(prompt: string, answer: string) {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const choices: ParsedChoice[] = [];
  const stemLines: string[] = [];

  lines.forEach((line, index) => {
    const normalizedLine = index === 0 ? line.replace(/^\d+\.\s*/, '') : line;
    const choiceMatch = normalizedLine.match(/^([A-Z])\.\s*(.+)$/);

    if (choiceMatch) {
      choices.push({
        label: choiceMatch[1],
        text: choiceMatch[2]
      });
      return;
    }

    stemLines.push(normalizedLine);
  });

  if (!choices.length && answer.trim()) {
    choices.push({
      label: 'Answer',
      text: answer.trim()
    });
  }

  return {
    stem: stemLines.join('\n').trim() || prompt.trim(),
    choices
  };
}

function getCorrectChoiceLabel(answer: string, choices: ParsedChoice[]) {
  const normalizedAnswer = answer.trim().toLowerCase();

  if (!normalizedAnswer) {
    return '';
  }

  const labelMatch = normalizedAnswer.match(/^([a-z])(?:\.|\)|\s|$)/);
  if (labelMatch) {
    return labelMatch[1].toUpperCase();
  }

  const exactChoice = choices.find(
    (choice) => choice.text.trim().toLowerCase() === normalizedAnswer
  );

  return exactChoice?.label ?? answer.trim();
}

function buildPerformanceAnalysis(accuracy: number, score: number, total: number) {
  if (accuracy >= 90) {
    return `Excellent recall. You answered ${score} out of ${total} correctly, which shows strong mastery and consistent recognition of the right choices.`;
  }

  if (accuracy >= 75) {
    return `Strong performance overall. You got ${score} out of ${total} correct, and a short targeted review should push this quiz even closer to mastery.`;
  }

  if (accuracy >= 50) {
    return `Developing understanding. You answered ${score} out of ${total} correctly, so reviewing missed concepts and retaking the quiz will likely improve retention quickly.`;
  }

  return `This attempt shows the topic still needs reinforcement. You answered ${score} out of ${total} correctly, so a guided review before the next retake would be the best next step.`;
}

function inferAnswerForQuestion(question: QuestionEntry) {
  const parsed = parsePromptChoices(question.prompt, question.answer);
  const mathMatch = parsed.stem.match(/(-?\d+(?:\.\d+)?)\s*([+\-x×*\/÷])\s*(-?\d+(?:\.\d+)?)/i);

  if (!mathMatch) {
    return '';
  }

  const left = Number(mathMatch[1]);
  const operator = mathMatch[2];
  const right = Number(mathMatch[3]);

  let result = 0;

  switch (operator) {
    case '+':
      result = left + right;
      break;
    case '-':
      result = left - right;
      break;
    case 'x':
    case 'X':
    case '×':
    case '*':
      result = left * right;
      break;
    case '/':
    case '÷':
      result = right === 0 ? Number.NaN : left / right;
      break;
    default:
      return '';
  }

  if (Number.isNaN(result)) {
    return '';
  }

  const normalizedResult = Number.isInteger(result) ? String(result) : String(Number(result.toFixed(2)));
  const matchingChoice = parsed.choices.find(
    (choice) => choice.text.replace(/,/g, '').trim() === normalizedResult
  );

  return matchingChoice?.label ?? normalizedResult;
}

function Practices() {
  const { isAuthenticated, user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [showQuestionCountModal, setShowQuestionCountModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [showPlayModal, setShowPlayModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAnswerAssistModal, setShowAnswerAssistModal] = useState(false);
  const [showQuizCollection, setShowQuizCollection] = useState(false);
  const [quizTitle, setQuizTitle] = useState('Weekly Mastery Check');
  const [quizCount, setQuizCount] = useState('5');
  const [savedTitle, setSavedTitle] = useState('Weekly Mastery Check');
  const [savedCount, setSavedCount] = useState('5');
  const [quizInstances, setQuizInstances] = useState<QuizInstance[]>(() =>
    createQuizInstances(5)
  );
  const [selectedQuizId, setSelectedQuizId] = useState(1);
  const [selectedItemCount, setSelectedItemCount] = useState('10');
  const [editorSourceText, setEditorSourceText] = useState('');
  const [editorQuestions, setEditorQuestions] = useState<QuestionEntry[]>(createDefaultQuestions(10));
  const [editorMode, setEditorMode] = useState<'text' | 'file'>('text');
  const [loadedFileName, setLoadedFileName] = useState('');
  const [isSourceScanned, setIsSourceScanned] = useState(false);
  const [isScanManualLocked, setIsScanManualLocked] = useState(false);
  const [scanMessage, setScanMessage] = useState('Paste questions or upload a PDF, DOC, DOCX, or text file to scan them.');
  const [saveValidationMessage, setSaveValidationMessage] = useState('');
  const [invalidAnswerQuestionIds, setInvalidAnswerQuestionIds] = useState<number[]>([]);
  const [isPracticeLoading, setIsPracticeLoading] = useState(false);
  const [practiceStatus, setPracticeStatus] = useState('');
  const [openQuizMenuId, setOpenQuizMenuId] = useState<number | null>(null);
  const [pendingDeleteQuizId, setPendingDeleteQuizId] = useState<number | null>(null);
  const [pendingSaveQuestions, setPendingSaveQuestions] = useState<QuestionEntry[] | null>(null);
  const [answerAssistMode, setAnswerAssistMode] = useState<AnswerAssistMode>('manual');
  const [answerAssistStep, setAnswerAssistStep] = useState<AnswerAssistStep>('select');
  const [answerAssistTrigger, setAnswerAssistTrigger] = useState<AnswerAssistTrigger>('save');
  const [answerAssistQuestionScope, setAnswerAssistQuestionScope] = useState<number | null>(null);
  const [playQuestionIndex, setPlayQuestionIndex] = useState(0);
  const [playSelectedChoice, setPlaySelectedChoice] = useState('');
  const [playResponses, setPlayResponses] = useState<Record<number, string>>({});
  const [playCompleted, setPlayCompleted] = useState(false);
  const [playResult, setPlayResult] = useState<QuizResultSummary | null>(null);
  const [showResultReview, setShowResultReview] = useState(false);

  const selectedQuiz = useMemo(
    () => quizInstances.find((quiz) => quiz.id === selectedQuizId) ?? null,
    [quizInstances, selectedQuizId]
  );
  const activePlayQuestion = selectedQuiz?.questions[playQuestionIndex] ?? null;
  const parsedPlayQuestion = activePlayQuestion
    ? parsePromptChoices(activePlayQuestion.prompt, activePlayQuestion.answer)
    : null;
  const answerAssistQuestions = pendingSaveQuestions?.slice(
    0,
    answerAssistTrigger === 'scan'
      ? answerAssistQuestionScope ?? pendingSaveQuestions.length
      : pendingSaveQuestions.length
  ) ?? [];
  const pendingMissingAnswerCount = answerAssistQuestions.filter(
    (question) => !question.answer.trim()
  ).length;

  useEffect(() => {
    if (!invalidAnswerQuestionIds.length) {
      setSaveValidationMessage('');
    }
  }, [invalidAnswerQuestionIds]);

  function applyPracticeWorkspace(nextTitle: string, nextQuizzes: QuizInstance[]) {
    setSavedTitle(nextTitle);
    setSavedCount(String(nextQuizzes.length));
    setQuizTitle(nextTitle);
    setQuizCount(String(Math.max(nextQuizzes.length, 1)));
    setQuizInstances(nextQuizzes);
  }

  async function persistPracticeWorkspace(nextTitle: string, nextQuizzes: QuizInstance[]) {
    applyPracticeWorkspace(nextTitle, nextQuizzes);

    if (!user.id) {
      return;
    }

    setPracticeStatus('Saving Practice to Supabase...');

    try {
      await upsertPracticeWorkspace({
        studentAccountId: user.id,
        title: nextTitle,
        quizCount: nextQuizzes.length,
        quizzes: nextQuizzes
      });
      setPracticeStatus('Practice synced to Supabase.');
    } catch {
      setPracticeStatus('Could not save Practice to Supabase.');
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !user.id) {
      return;
    }

    let cancelled = false;

    async function loadPracticeWorkspace() {
      setIsPracticeLoading(true);
      setPracticeStatus('Loading Practice from Supabase...');

      try {
        const workspace = await getPracticeWorkspace(user.id);

        if (cancelled) {
          return;
        }

        if (workspace) {
          const nextTitle = workspace.title || 'Weekly Mastery Check';
          const nextQuizzes = createQuizInstances(
            workspace.quiz_count ?? 0,
            Array.isArray(workspace.quizzes) ? workspace.quizzes : []
          );
          applyPracticeWorkspace(nextTitle, nextQuizzes);
          setPracticeStatus('Practice loaded from Supabase.');
          return;
        }

        const defaultQuizzes = createQuizInstances(5);
        applyPracticeWorkspace('Weekly Mastery Check', defaultQuizzes);
        await upsertPracticeWorkspace({
          studentAccountId: user.id,
          title: 'Weekly Mastery Check',
          quizCount: defaultQuizzes.length,
          quizzes: defaultQuizzes
        });
        setPracticeStatus('Practice workspace created in Supabase.');
      } catch {
        if (!cancelled) {
          setPracticeStatus('Could not load Practice from Supabase.');
        }
      } finally {
        if (!cancelled) {
          setIsPracticeLoading(false);
        }
      }
    }

    void loadPracticeWorkspace();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user.id]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextCount = Number(quizCount);
    const nextTitle = quizTitle.trim() || 'Untitled Quiz';
    const nextQuizzes = createQuizInstances(nextCount, quizInstances);
    void persistPracticeWorkspace(nextTitle, nextQuizzes);
    setShowQuizModal(false);
  }

  function handleOpenQuizCollection() {
    setShowQuizCollection((current) => !current);
  }

  function openQuizCountStep(quizId: number) {
    const quiz = quizInstances.find((entry) => entry.id === quizId);
    const currentCount = String(quiz?.itemCount ?? 10);

    setSelectedQuizId(quizId);
    setSelectedItemCount(currentCount);
    setShowPlayModal(false);
    setShowQuestionCountModal(true);
  }

  function launchQuizEditor(quizId: number, questionCount: number) {
    const quiz = quizInstances.find((entry) => entry.id === quizId);
    const nextDraftQuestions = buildQuestionDrafts(questionCount, [], quiz?.questions ?? []);

    setSelectedQuizId(quizId);
    setSelectedItemCount(String(questionCount));
    setEditorSourceText(quiz?.sourceText ?? '');
    setEditorQuestions(nextDraftQuestions);
    setQuizInstances((current) =>
      current.map((entry) =>
        entry.id === quizId
          ? {
              ...entry,
              itemCount: questionCount,
              questions: nextDraftQuestions
            }
          : entry
      )
    );
    setLoadedFileName('');
    setIsSourceScanned(false);
    setIsScanManualLocked(false);
    setSaveValidationMessage('');
    setInvalidAnswerQuestionIds([]);
    setEditorMode('text');
    setScanMessage('Paste questions or upload a PDF, DOC, DOCX, or text file to scan them.');
    setShowQuestionCountModal(false);
    setShowPlayModal(false);
    setOpenQuizMenuId(null);
    setShowItemsModal(true);
  }

  function openQuizPlayer(quizId: number) {
    setSelectedQuizId(quizId);
    setPlayQuestionIndex(0);
    setPlaySelectedChoice('');
    setPlayResponses({});
    setPlayCompleted(false);
    setPlayResult(null);
    setShowResultReview(false);
    setShowPlayModal(true);
  }

  function handleEditQuiz(quizId: number) {
    const quiz = quizInstances.find((entry) => entry.id === quizId);
    launchQuizEditor(quizId, quiz?.itemCount ?? 10);
  }

  function handleDeleteQuizRequest(quizId: number) {
    setPendingDeleteQuizId(quizId);
    setOpenQuizMenuId(null);
    setShowDeleteModal(true);
  }

  function handleConfirmDeleteQuiz() {
    if (pendingDeleteQuizId === null) {
      return;
    }

    const nextQuizzes = quizInstances
      .filter((quiz) => quiz.id !== pendingDeleteQuizId)
      .map((quiz, index) => ({
        ...quiz,
        id: index + 1,
        questions: quiz.questions.map((question, questionIndex) => ({
          ...question,
          id: questionIndex + 1
        }))
      }));

    void persistPracticeWorkspace(savedTitle, nextQuizzes);
    setSelectedQuizId(1);
    setPendingDeleteQuizId(null);
    setShowDeleteModal(false);
    setShowPlayModal(false);
    setShowItemsModal(false);
    setShowQuestionCountModal(false);
  }

  function openQuizResultSummary(quizId: number) {
    const quiz = quizInstances.find((entry) => entry.id === quizId);

    if (!quiz) {
      return;
    }

    setSelectedQuizId(quizId);
    setPlayQuestionIndex(0);
    setPlaySelectedChoice('');
    setPlayResponses(quiz.lastResponses ?? {});
    setPlayCompleted(true);
    setShowResultReview(false);
    setPlayResult({
      accuracy: quiz.lastAccuracy,
      attempt: quiz.attempts,
      score: quiz.lastScore,
      total: quiz.questions.length,
      analysis:
        quiz.lastAnalysis || buildPerformanceAnalysis(quiz.lastAccuracy, quiz.lastScore, quiz.questions.length)
    });
    setShowPlayModal(true);
  }

  function handleQuizCardClick(quiz: QuizInstance) {
    if (quiz.attempts > 0) {
      openQuizResultSummary(quiz.id);
      return;
    }

    if (hasSavedQuizContent(quiz)) {
      openQuizPlayer(quiz.id);
      return;
    }

    openQuizCountStep(quiz.id);
  }

  function openQuizEditor() {
    launchQuizEditor(selectedQuizId, Number(selectedItemCount));
  }

  function handleItemCountChange(nextValue: string) {
    const nextCount = Number(nextValue);
    setSelectedItemCount(nextValue);
    setEditorQuestions((current) => buildQuestionDrafts(nextCount, [], current));
  }

  function handleScanQuestions() {
    const limit = Number(selectedItemCount);
    const shouldLockManualChoice = isSourceScanned && isScanManualLocked;
    const { questions: parsedQuestions, totalDetected } = createQuestionsFromSource(
      editorSourceText,
      limit
    );

    if (!parsedQuestions.length) {
      setScanMessage('No questions were detected. Try numbered questions like 1. 2. 3.');
      return;
    }

    const nextQuestions = buildScannedQuestionDrafts(limit, parsedQuestions, editorQuestions);
    const missingAnswersCount = nextQuestions
      .slice(0, parsedQuestions.length)
      .filter((question) => !question.answer.trim()).length;
    const detectedAnswersCount = parsedQuestions.length - missingAnswersCount;

    setEditorQuestions(nextQuestions);
    setIsSourceScanned(true);

    if (missingAnswersCount > 0) {
      setPendingSaveQuestions(nextQuestions);
      setAnswerAssistMode(shouldLockManualChoice ? 'ai' : 'manual');
      setAnswerAssistStep('select');
      setAnswerAssistTrigger('scan');
      setAnswerAssistQuestionScope(parsedQuestions.length);
      setShowAnswerAssistModal(true);
      setScanMessage(
        `Scanned ${parsedQuestions.length} question${
          parsedQuestions.length === 1 ? '' : 's'
        } from ${editorMode === 'file' && loadedFileName ? loadedFileName : 'the text input'}${
          totalDetected > limit ? `. Only the first ${limit} question${limit === 1 ? '' : 's'} were used.` : '.'
        } ${
          detectedAnswersCount > 0
            ? `${detectedAnswersCount} answer${detectedAnswersCount === 1 ? ' was' : 's were'} found automatically.`
            : 'No answers were found in the source.'
        }`
      );
      return;
    }

    setPendingSaveQuestions(null);
    setAnswerAssistTrigger('save');
    setAnswerAssistQuestionScope(null);
    setScanMessage(
      `Scanned ${parsedQuestions.length} question${
        parsedQuestions.length === 1 ? '' : 's'
      } from ${editorMode === 'file' && loadedFileName ? loadedFileName : 'the text input'}${
        totalDetected > limit ? `. Only the first ${limit} question${limit === 1 ? '' : 's'} were used` : ''
      } and filled the answers automatically.`
    );
  }

  function handleQuestionChange(questionId: number, field: 'prompt' | 'answer', value: string) {
    setEditorQuestions((current) =>
      current.map((question) =>
        question.id === questionId ? { ...question, [field]: value } : question
      )
    );

    if (field === 'answer' && value.trim()) {
      setInvalidAnswerQuestionIds((current) => current.filter((id) => id !== questionId));
    }
  }

  function handleAddQuestion() {
    setEditorQuestions((current) => {
      const nextQuestion = {
        id: current.length + 1,
        prompt: `Question ${current.length + 1}`,
        answer: ''
      };

      const nextQuestions = [...current, nextQuestion];
      setSelectedItemCount(String(nextQuestions.length));
      return nextQuestions;
    });
    setScanMessage('Added a new question card. You can type the question and answer manually.');
  }

  async function handleFileLoad(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const extracted = await extractTextFromQuestionFile(file);
      setEditorMode('file');
      setLoadedFileName(file.name);
      setIsSourceScanned(false);
      setIsScanManualLocked(false);
      setEditorSourceText(extracted.text);
      setScanMessage(
        `${file.name} (${extracted.sourceLabel}) is ready. Click Scan to check for answers and fill the question cards.`
      );
    } catch {
      setScanMessage('This file could not be read. Try PDF, DOCX, or a text-based document with numbered questions.');
    } finally {
      event.target.value = '';
    }
  }

  function handleSourceTextChange(value: string) {
    setEditorSourceText(value);
    setIsSourceScanned(false);
    setIsScanManualLocked(false);
  }

  function handleClearLoadedFile() {
    setLoadedFileName('');
    setEditorMode('text');
    setEditorSourceText('');
    setEditorQuestions(createDefaultQuestions(Number(selectedItemCount)));
    setIsSourceScanned(false);
    setIsScanManualLocked(false);
    setSaveValidationMessage('');
    setInvalidAnswerQuestionIds([]);
    setPendingSaveQuestions(null);
    setAnswerAssistStep('select');
    setAnswerAssistQuestionScope(null);
    setShowAnswerAssistModal(false);
    setScanMessage('Current file cleared. Upload a new file or paste new questions to scan again.');
  }

  function commitQuizItems(nextQuestions: QuestionEntry[]) {
    const nextQuizzes = quizInstances.map((quiz) =>
      quiz.id === selectedQuizId
        ? {
            ...quiz,
            itemCount: nextQuestions.length,
            sourceText: editorSourceText,
            questions: nextQuestions.length
              ? nextQuestions
              : createDefaultQuestions(Number(selectedItemCount))
          }
        : quiz
    );

    void persistPracticeWorkspace(savedTitle, nextQuizzes);
    setPendingSaveQuestions(null);
    setAnswerAssistQuestionScope(null);
    setSaveValidationMessage('');
    setInvalidAnswerQuestionIds([]);
    setShowAnswerAssistModal(false);
    setShowItemsModal(false);
  }

  function handleSaveItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedQuestions = editorQuestions
      .map((question, index) => ({
        id: index + 1,
        prompt: question.prompt.trim() || `Question ${index + 1}`,
        answer: question.answer.trim()
      }))
      .filter((question) => question.prompt.trim().length > 0);

    const missingAnswerIds = cleanedQuestions
      .filter((question) => !question.answer.trim())
      .map((question) => question.id);

    if (missingAnswerIds.length) {
      setSaveValidationMessage('Save Quiz will not proceed because there are still unfinished questions.');
      setInvalidAnswerQuestionIds(missingAnswerIds);
      return;
    }

    setSaveValidationMessage('');
    setInvalidAnswerQuestionIds([]);
    commitQuizItems(cleanedQuestions);
  }

  function handleConfirmAnswerAssist() {
    if (!pendingSaveQuestions?.length) {
      setShowAnswerAssistModal(false);
      return;
    }

    if (answerAssistMode === 'manual') {
      setShowAnswerAssistModal(false);
      setAnswerAssistStep('select');
      if (answerAssistTrigger === 'scan') {
        setIsSourceScanned(true);
        setIsScanManualLocked(true);
      }
      setScanMessage(
        answerAssistTrigger === 'scan'
          ? 'Scan complete. Please review the questions and type the missing answers manually.'
          : 'Some questions still have no answer. Please enter the missing answers manually before saving.'
      );
      return;
    }

    handleConfirmAiAnswerAssist();
  }

  function handleConfirmAiAnswerAssist() {
    if (!pendingSaveQuestions?.length) {
      setShowAnswerAssistModal(false);
      setAnswerAssistStep('select');
      return;
    }

    const scopedQuestionCount =
      answerAssistTrigger === 'scan'
        ? answerAssistQuestionScope ?? pendingSaveQuestions.length
        : pendingSaveQuestions.length;
    const generatedQuestions = pendingSaveQuestions.map((question, index) =>
      index >= scopedQuestionCount || question.answer.trim()
        ? question
        : {
            ...question,
            answer: inferAnswerForQuestion(question)
          }
    );
    const unansweredBeforeGeneration = pendingSaveQuestions
      .slice(0, scopedQuestionCount)
      .filter((question) => !question.answer.trim()).length;
    const unresolvedCount = generatedQuestions
      .slice(0, scopedQuestionCount)
      .filter((question) => !question.answer.trim()).length;
    const filledCount = unansweredBeforeGeneration - unresolvedCount;

    setEditorQuestions(generatedQuestions);
    setPendingSaveQuestions(generatedQuestions);

    if (answerAssistTrigger === 'scan') {
      setShowAnswerAssistModal(false);
      setAnswerAssistStep('select');
      setPendingSaveQuestions(null);
      setAnswerAssistQuestionScope(null);
      setIsSourceScanned(true);

      if (unresolvedCount > 0) {
        setScanMessage(
          `AI filled ${filledCount} answer${
            filledCount === 1 ? '' : 's'
          }, but ${unresolvedCount} still need manual review.`
        );
        return;
      }

      setScanMessage('AI filled the missing answers into the Type the correct answer fields. Please review them before saving the quiz.');
      return;
    }

    if (unresolvedCount > 0) {
      setShowAnswerAssistModal(false);
      setAnswerAssistStep('select');
      setScanMessage(
        `AI filled ${filledCount} answer${
          filledCount === 1 ? '' : 's'
        }, but ${unresolvedCount} still need manual review.`
      );
      return;
    }

    setScanMessage('AI generated the missing answers and the quiz was saved.');
    commitQuizItems(generatedQuestions);
  }

  function handleSubmitPlayQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activePlayQuestion || !playSelectedChoice) {
      return;
    }

    const nextResponses = {
      ...playResponses,
      [activePlayQuestion.id]: playSelectedChoice
    };

    setPlayResponses(nextResponses);

    if (!selectedQuiz || playQuestionIndex >= selectedQuiz.questions.length - 1) {
      const total = selectedQuiz?.questions.length ?? 0;
      const score = (selectedQuiz?.questions ?? []).reduce((currentScore, question) => {
        const parsedQuestion = parsePromptChoices(question.prompt, question.answer);
        const correctChoiceLabel = getCorrectChoiceLabel(question.answer, parsedQuestion.choices);
        const chosenLabel = nextResponses[question.id] ?? '';

        return chosenLabel === correctChoiceLabel ? currentScore + 1 : currentScore;
      }, 0);
      const accuracy = total ? Math.round((score / total) * 100) : 0;
      const nextAttempt = (selectedQuiz?.attempts ?? 0) + 1;
      const analysis = buildPerformanceAnalysis(accuracy, score, total);

      const nextQuizzes = quizInstances.map((quiz) =>
          quiz.id === selectedQuizId
            ? {
                ...quiz,
                attempts: nextAttempt,
                lastScore: score,
                lastAccuracy: accuracy,
                lastAnalysis: analysis,
                lastResponses: nextResponses
              }
            : quiz
      );
      void persistPracticeWorkspace(savedTitle, nextQuizzes);
      setPlayResult({
        accuracy,
        attempt: nextAttempt,
        score,
        total,
        analysis
      });
      setPlayCompleted(true);
      setShowResultReview(false);
      return;
    }

    const nextIndex = playQuestionIndex + 1;
    setPlayQuestionIndex(nextIndex);
    setPlaySelectedChoice(nextResponses[nextIndex + 1] ?? '');
  }

  function handleRestartQuiz() {
    setPlayQuestionIndex(0);
    setPlaySelectedChoice('');
    setPlayResponses({});
    setPlayCompleted(false);
    setPlayResult(null);
    setShowResultReview(false);
  }

  const currentQuestionCount = editorQuestions.length;

  return (
    <>
      <section className="practice-builder-shell page-enter glass-panel">
        <div className="practice-intro">
          <span className="eyebrow">Practices</span>
          <h1>Practices</h1>
          <p>Choose a practice module, create quizzes, then set the questions and answers for each quiz.</p>
          <div className="practice-sync-note">
            {isPracticeLoading ? 'Syncing Practice workspace...' : practiceStatus || 'Practice workspace ready.'}
          </div>
        </div>

        <div className="practice-grid">
          <button
            className="practice-tile"
            onClick={handleOpenQuizCollection}
            type="button"
          >
            <div className="practice-tile-top">
              <div className="practice-tile-icon">Q</div>
              <span className="practice-tile-badge">Quiz</span>
            </div>

            <div className="practice-tile-copy">
              <h2>{savedTitle}</h2>
              <p>Click this created quiz to show all {savedCount} quizzes and manage each one.</p>
            </div>

            <div className="practice-tile-foot">
              <span className="practice-meta">
                {savedCount} {Number(savedCount) === 1 ? 'quiz' : 'quizzes'}
              </span>
              <span className="practice-arrow">{showQuizCollection ? '-' : '+'}</span>
            </div>
          </button>
        </div>

        <div className="practice-summary">
          <div className="practice-summary-head">
            <div>
              <div className="practice-summary-label">Current Quiz Setup</div>
              <strong>{savedTitle}</strong>
              <p>
                {savedCount} {Number(savedCount) === 1 ? 'quiz' : 'quizzes'} selected
              </p>
            </div>
            <button
              className="practice-secondary-button"
              onClick={() => setShowQuizModal(true)}
              type="button"
            >
              Edit Quiz Setup
            </button>
          </div>
        </div>

        {showQuizCollection && (
          <div className="practice-collection page-enter">
            <div className="practice-collection-head">
              <div>
                <div className="practice-summary-label">Created Quizzes</div>
                <strong>{savedTitle}</strong>
                <p>Click any quiz card below to paste questions, upload a file, and save answers.</p>
              </div>
            </div>

            <div className="practice-quiz-list">
              {quizInstances.map((quiz) => (
                <article
                  key={quiz.id}
                  className="practice-quiz-card"
                  onClick={() => handleQuizCardClick(quiz)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleQuizCardClick(quiz);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="practice-quiz-card-top">
                    <span className="practice-quiz-number">Quiz {quiz.id}</span>
                    <div className="practice-quiz-actions">
                      <button
                        aria-label={`Open actions for Quiz ${quiz.id}`}
                        className="practice-menu-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenQuizMenuId((current) => (current === quiz.id ? null : quiz.id));
                        }}
                        type="button"
                      >
                        <span />
                        <span />
                        <span />
                      </button>
                      {openQuizMenuId === quiz.id && (
                        <div
                          className="practice-menu-dropdown"
                          onClick={(event) => event.stopPropagation()}
                          role="menu"
                        >
                          {hasSavedQuizContent(quiz) && (
                            <button
                              className="practice-menu-item"
                              onClick={() => handleEditQuiz(quiz.id)}
                              type="button"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            className="practice-menu-item delete"
                            onClick={() => handleDeleteQuizRequest(quiz.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                      <span className="practice-quiz-pill">{quiz.itemCount} items</span>
                    </div>
                  </div>
                  <h3>
                    {savedTitle} {quiz.id}
                  </h3>
                  <p>
                    {quiz.attempts > 0
                      ? 'Open this quiz to view your saved score, attempt, and analysis.'
                      : hasSavedQuizContent(quiz)
                      ? 'Open this saved quiz to answer one question at a time.'
                      : 'Open this quiz to scan text or a file and fill the answer textboxes.'}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <Modal
        open={showQuizModal}
        title="Quiz Setup"
        onClose={() => setShowQuizModal(false)}
      >
        <form className="practice-form" onSubmit={handleSubmit}>
          <label className="practice-field">
            <span>Quiz title</span>
            <input
              className="practice-input"
              onChange={(event) => setQuizTitle(event.target.value)}
              placeholder="Enter quiz title"
              type="text"
              value={quizTitle}
            />
          </label>

          <label className="practice-field">
            <span>How many quizzes do you want?</span>
            <select
              className="practice-select"
              onChange={(event) => setQuizCount(event.target.value)}
              value={quizCount}
            >
              {Array.from({ length: 10 }, (_, index) => {
                const value = String(index + 1);
                return (
                  <option key={value} value={value}>
                    {value}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="practice-preview-card">
            <div className="practice-preview-label">Preview</div>
            <strong>{quizTitle.trim() || 'Untitled Quiz'}</strong>
            <p>
              {quizCount} {Number(quizCount) === 1 ? 'quiz' : 'quizzes'} ready to prepare
            </p>
          </div>

          <button className="practice-submit" type="submit">
            Save Quiz Setup
          </button>
        </form>
      </Modal>

      <Modal
        open={showQuestionCountModal}
        title={selectedQuiz ? `${savedTitle} ${selectedQuiz.id} Setup` : 'Question Count'}
        onClose={() => setShowQuestionCountModal(false)}
      >
        <form
          className="practice-form"
          onSubmit={(event) => {
            event.preventDefault();
            openQuizEditor();
          }}
        >
          <label className="practice-field">
            <span>
              How many questions should {selectedQuiz ? `Quiz ${selectedQuiz.id}` : 'this quiz'} have?
            </span>
            <select
              className="practice-select"
              onChange={(event) => setSelectedItemCount(event.target.value)}
              value={selectedItemCount}
            >
              {Array.from({ length: 50 }, (_, index) => {
                const value = String(index + 1);
                return (
                  <option key={value} value={value}>
                    {value} {index === 0 ? 'question' : 'questions'}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="practice-preview-card">
            <div className="practice-preview-label">Selected Quiz</div>
            <strong>
              {selectedQuiz ? `${savedTitle} ${selectedQuiz.id}` : savedTitle}
            </strong>
            <p>
              {selectedItemCount} {Number(selectedItemCount) === 1 ? 'question' : 'questions'} will be created before the editor opens
            </p>
          </div>

          <button className="practice-submit" type="submit">
            Continue to Quiz Builder
          </button>
        </form>
      </Modal>

      <Modal
        open={showDeleteModal}
        title="Delete Quiz"
        onClose={() => {
          setPendingDeleteQuizId(null);
          setShowDeleteModal(false);
        }}
      >
        <div className="practice-delete-shell">
          <p className="practice-delete-copy">
            Are you sure you want to delete{' '}
            <strong>
              {pendingDeleteQuizId ? `${savedTitle} ${pendingDeleteQuizId}` : 'this quiz'}
            </strong>
            ?
          </p>
          <div className="practice-delete-actions">
            <button
              className="practice-cancel-button"
              onClick={() => {
                setPendingDeleteQuizId(null);
                setShowDeleteModal(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="practice-danger-button" onClick={handleConfirmDeleteQuiz} type="button">
              Delete
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showAnswerAssistModal}
        backdropClassName="modal-backdrop-front"
        title={answerAssistTrigger === 'scan' ? 'Answers Not Found' : 'Missing Answers'}
        onClose={() => {
          setShowAnswerAssistModal(false);
          setAnswerAssistStep('select');
        }}
      >
        <div className="practice-answer-assist-shell">
          <p className="practice-answer-assist-copy">
            {pendingMissingAnswerCount} question
            {pendingMissingAnswerCount === 1
              ? ''
              : 's'}{' '}
            {answerAssistTrigger === 'scan'
              ? 'do not have an answer in the scanned source. Do you want to use our AI model or answer them manually?'
              : 'still have no answer. Choose whether you want to generate the answer with AI or enter it manually.'}
          </p>

          <div className="practice-answer-assist-options">
            <button
              className={`practice-answer-assist-option ${
                answerAssistMode === 'manual' ? 'active' : ''
              } ${answerAssistTrigger === 'scan' && isScanManualLocked ? 'disabled' : ''}`}
              disabled={answerAssistTrigger === 'scan' && isScanManualLocked}
              onClick={() => setAnswerAssistMode('manual')}
              type="button"
            >
              <span>Manual</span>
              <small>
                {answerAssistTrigger === 'scan' && isScanManualLocked
                  ? 'Manual was already used for this scanned file. Choose AI Generate if you want help filling the remaining answers.'
                  : answerAssistTrigger === 'scan'
                  ? 'Keep the scanned questions in the builder and type the missing answers yourself.'
                  : 'Keep the builder open so you can type the missing answers yourself.'}
              </small>
            </button>

            <button
              className={`practice-answer-assist-option ${
                answerAssistMode === 'ai' ? 'active' : ''
              }`}
              onClick={() => setAnswerAssistMode('ai')}
              type="button"
            >
              <span>AI Generate</span>
              <small>
                {answerAssistTrigger === 'scan'
                  ? 'Let our AI model try to infer the missing correct answers from the scanned questions and fill them automatically.'
                  : 'Try to infer the missing correct answers and fill them automatically.'}
              </small>
            </button>
          </div>

          <div className="practice-answer-assist-actions">
            <button
              className="practice-cancel-button"
              onClick={() => {
                setShowAnswerAssistModal(false);
                setAnswerAssistStep('select');
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="practice-submit" onClick={handleConfirmAnswerAssist} type="button">
              {answerAssistMode === 'ai' ? 'Generate Answers' : 'OK'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showItemsModal}
        title={selectedQuiz ? `${savedTitle} ${selectedQuiz.id}` : 'Quiz Builder'}
        onClose={() => setShowItemsModal(false)}
      >
        <form className="practice-builder-form" onSubmit={handleSaveItems}>
          <div className="practice-builder-toolbar">
            <div className="practice-builder-summary">
              <span className="practice-builder-summary-label">Question Count</span>
              <strong>
                {selectedItemCount} {Number(selectedItemCount) === 1 ? 'question' : 'questions'}
              </strong>
            </div>

            <div className="practice-mode-toggle">
              <button
                className={`practice-mode-button ${editorMode === 'text' ? 'active' : ''}`}
                onClick={() => setEditorMode('text')}
                type="button"
              >
                Paste Text
              </button>
              <button
                className={`practice-mode-button ${editorMode === 'file' ? 'active' : ''}`}
                onClick={() => {
                  setEditorMode('file');
                  fileInputRef.current?.click();
                }}
                type="button"
              >
                Upload File
              </button>
            </div>
          </div>

          <div className="practice-builder-grid">
            <div className="practice-source-panel">
              <div className="practice-panel-head">
                <div>
                  <div className="practice-summary-label">Source</div>
                  <strong>Questions Input</strong>
                </div>
              </div>

              <textarea
                className="practice-source-textarea"
                onChange={(event) => handleSourceTextChange(event.target.value)}
                placeholder={`Paste questions like:\n\n1. What is Sora?\nA. A music app\nB. An AI video generation tool\nC. A game console\nD. A social media platform`}
                value={editorSourceText}
              />

              <div className="practice-source-actions">
                <button className="practice-scan-button" onClick={handleScanQuestions} type="button">
                  {isSourceScanned ? 'Scanned' : 'Scan'}
                </button>
              </div>

              <div className="practice-file-row">
                <button
                  className="practice-file-button"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  File
                </button>
                <span className="practice-file-note">
                  {loadedFileName || 'File'}
                </span>
                {loadedFileName && (
                  <button
                    aria-label="Clear current file"
                    className="practice-file-clear"
                    onClick={handleClearLoadedFile}
                    type="button"
                  >
                    x
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  accept=".txt,.md,.csv,.pdf,.doc,.docx,text/plain,text/markdown,text/csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="practice-file-input"
                  onChange={handleFileLoad}
                  type="file"
                />
              </div>

              <p className="practice-scan-message">{scanMessage}</p>
            </div>

            <div className="practice-answers-panel">
              <div className="practice-panel-head">
                <div>
                  <div className="practice-summary-label">Answers</div>
                  <strong>
                    {currentQuestionCount} {currentQuestionCount === 1 ? 'Question' : 'Questions'}
                  </strong>
                </div>
                <button className="practice-add-button" onClick={handleAddQuestion} type="button">
                  + Add Question
                </button>
              </div>

              {saveValidationMessage && (
                <p className="practice-validation-message">{saveValidationMessage}</p>
              )}

              <div className="practice-question-list">
                {editorQuestions.map((question) => {
                  const isAnswerMissing = invalidAnswerQuestionIds.includes(question.id);

                  return (
                  <div
                    className={`practice-question-card ${isAnswerMissing ? 'invalid' : ''}`}
                    key={question.id}
                  >
                    <div className="practice-question-head">
                      <span className={`practice-quiz-number ${isAnswerMissing ? 'invalid' : ''}`}>
                        Q{question.id}
                      </span>
                    </div>
                    <textarea
                      className="practice-question-input"
                      onChange={(event) =>
                        handleQuestionChange(question.id, 'prompt', event.target.value)
                      }
                      value={question.prompt}
                    />
                    <input
                      aria-invalid={isAnswerMissing}
                      className={`practice-answer-input ${isAnswerMissing ? 'invalid' : ''}`}
                      onChange={(event) =>
                        handleQuestionChange(question.id, 'answer', event.target.value)
                      }
                      placeholder="Type the correct answer"
                      type="text"
                      value={question.answer}
                    />
                    {isAnswerMissing && (
                      <p className="practice-answer-error">Please type the answer</p>
                    )}
                  </div>
                )})}
              </div>
            </div>
          </div>

          <button className="practice-submit" type="submit">
            Save Quiz
          </button>
        </form>
      </Modal>

      <Modal
        open={showPlayModal}
        title={selectedQuiz ? `${savedTitle} ${selectedQuiz.id}` : 'Quiz Player'}
        onClose={() => setShowPlayModal(false)}
      >
        {selectedQuiz && (
          <div className="practice-play-shell">
            {!playCompleted && activePlayQuestion && parsedPlayQuestion ? (
              <form className="practice-play-form" onSubmit={handleSubmitPlayQuestion}>
                <div className="practice-play-head">
                  <div>
                    <div className="practice-preview-label">Question Progress</div>
                    <strong>
                      Question {playQuestionIndex + 1} of {selectedQuiz.questions.length}
                    </strong>
                  </div>
                  <button
                    className="practice-secondary-button"
                    onClick={() => openQuizCountStep(selectedQuiz.id)}
                    type="button"
                  >
                    Edit Quiz Content
                  </button>
                </div>

                <div className="practice-play-card">
                  <h4>{parsedPlayQuestion.stem}</h4>
                  <div className="practice-choice-list">
                    {parsedPlayQuestion.choices.map((choice) => (
                      <button
                        key={`${activePlayQuestion.id}-${choice.label}`}
                        className={`practice-choice-card ${
                          playSelectedChoice === choice.label ? 'selected' : ''
                        }`}
                        onClick={() => setPlaySelectedChoice(choice.label)}
                        type="button"
                      >
                        <span className="practice-choice-label">{choice.label}</span>
                        <span>{choice.text}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  className="practice-submit"
                  disabled={!playSelectedChoice}
                  type="submit"
                >
                  {playQuestionIndex === selectedQuiz.questions.length - 1
                    ? 'Submit Quiz'
                    : 'Submit and Next Question'}
                </button>
              </form>
            ) : (
              <div className="practice-results-shell">
                <div className="practice-play-head">
                  <div>
                    <div className="practice-preview-label">Quiz Complete</div>
                    <strong>
                      Accuracy: {playResult?.accuracy ?? 0}%
                    </strong>
                  </div>
                </div>

                <div className="practice-score-hero">
                  <div
                    className="practice-score-ring"
                    style={
                      {
                        '--score-sweep': `${Math.round(((playResult?.accuracy ?? 0) / 100) * 360)}deg`
                      } as CSSProperties
                    }
                  >
                    <span>{playResult?.accuracy ?? 0}%</span>
                  </div>
                  <div className="practice-score-copy">
                    <h4>{selectedQuiz.questions.length} question{selectedQuiz.questions.length === 1 ? '' : 's'} completed</h4>
                    <p>Your latest attempt has been saved for this quiz.</p>
                  </div>
                </div>

                <div className="practice-results-grid">
                  <article className="practice-result-card">
                    <div className="practice-result-label">Attempt</div>
                    <strong>{playResult?.attempt ?? 0}</strong>
                  </article>
                  <article className="practice-result-card">
                    <div className="practice-result-label">Attempt Score</div>
                    <strong>
                      {playResult?.score ?? 0} / {playResult?.total ?? 0}
                    </strong>
                  </article>
                  <article className="practice-result-card">
                    <div className="practice-result-label">Total</div>
                    <strong>{playResult?.total ?? 0}</strong>
                  </article>
                </div>

                <div className="practice-analysis-card">
                  <div className="practice-preview-label">AI Analysis</div>
                  <p>{playResult?.analysis ?? 'No analysis available yet.'}</p>
                </div>

                <button
                  className="practice-show-result"
                  onClick={() => setShowResultReview((current) => !current)}
                  type="button"
                >
                  {showResultReview ? 'Hide Result' : 'Show Result'}
                </button>

                {showResultReview && (
                  <div className="practice-results-list">
                    {selectedQuiz.questions.map((question) => {
                      const parsedQuestion = parsePromptChoices(question.prompt, question.answer);
                      const correctChoiceLabel = getCorrectChoiceLabel(question.answer, parsedQuestion.choices);
                      const chosenLabel = playResponses[question.id] ?? '';
                      const selectedChoice = parsedQuestion.choices.find(
                        (choice) => choice.label === chosenLabel
                      );
                      const correctChoice = parsedQuestion.choices.find(
                        (choice) => choice.label === correctChoiceLabel
                      );
                      const isCorrect = Boolean(chosenLabel) && chosenLabel === correctChoiceLabel;

                      return (
                        <article
                          className={`practice-review-card ${isCorrect ? 'correct' : 'wrong'}`}
                          key={question.id}
                        >
                          <div className="practice-review-head">
                            <strong className="practice-review-number">
                              {isCorrect ? `Q${question.id}` : `Q${question.id} X`}
                            </strong>
                          </div>
                          <h4>{parsedQuestion.stem}</h4>
                          <div className="practice-review-answer-row">
                            <span className="practice-review-label">Your answer</span>
                            <span className={`practice-review-answer ${isCorrect ? 'correct' : 'wrong'}`}>
                              {selectedChoice
                                ? `${selectedChoice.label}. ${selectedChoice.text}`
                                : 'No answer selected'}
                            </span>
                          </div>
                          {!isCorrect && (
                            <div className="practice-review-answer-row">
                              <span className="practice-review-label">Correct answer</span>
                              <span className="practice-review-correct-answer">
                                {correctChoice
                                  ? `${correctChoice.label}. ${correctChoice.text}`
                                  : question.answer}
                              </span>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}

                <div className="practice-results-actions">
                  <button
                    className="practice-secondary-button"
                    onClick={() => {
                      setShowResultReview(false);
                      setShowPlayModal(false);
                    }}
                    type="button"
                  >
                    Close
                  </button>
                  <button className="practice-submit" onClick={handleRestartQuiz} type="button">
                    Retake
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

export default Practices;
