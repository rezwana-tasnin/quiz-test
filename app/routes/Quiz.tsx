import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/Quiz";
import { Button } from "~/components/Button";
import questionsJson from "~/data/questions.json";
import { cn } from "~/utils/cn";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Quiz Test — GK Brain Twist" },
    {
      name: "description",
      content:
        "A lively Bangla GK brain-twist quiz with timed rounds, smart scoring reactions, and a category-ready arena UI.",
    },
    { property: "og:title", content: "Quiz Test — GK Brain Twist" },
    {
      property: "og:description",
      content:
        "Timed Bangla riddles, score reactions, and a polished quiz arena built for portfolio demos.",
    },
  ];
}

type TUser = {
  name: string;
  age?: number;
};

type TQuestionOption = {
  id: number;
  title: string;
};

type TQuestion = {
  id: number;
  title: string;
  rightAnswer: number;
  options: TQuestionOption[];
  difficulty?: "easy" | "medium" | "hard";
};

type TResultItem = TQuestion & {
  optionId?: number;
  isRight: boolean;
};

type TQuiz = {
  id: number;
  date: Date;
  status: "pending" | "running" | "done";
  examinee: TUser;
  optionIds: number[];
  questionIds: number[];
  questionIndex: number;
  results?: TResultItem[];
  timeLimitSec?: number;
};

/** Bump when round size / scoreboard schema changes so old 5-question saves don't stick. */
const QUIZ_STORAGE_VERSION = "v4-nav";
const QUIZ_STORAGE_VERSION_KEY = "quizStorageVersion";

type TScreen = "start" | "running" | "done";

function migrateQuizStorageIfNeeded() {
  if (typeof window === "undefined") return;
  try {
    const current = window.localStorage.getItem(QUIZ_STORAGE_VERSION_KEY);
    if (current === QUIZ_STORAGE_VERSION) return;

    // Drop stale in-progress/done quizzes (old builds used 5 questions + old FX)
    window.localStorage.removeItem("quizzes");
    // Drop pre-v2 seen maps if any linger
    window.localStorage.removeItem("quizSeenByUser");
    window.localStorage.removeItem("quizSeenGlobal");

    window.localStorage.setItem(QUIZ_STORAGE_VERSION_KEY, QUIZ_STORAGE_VERSION);
  } catch {
    // ignore
  }
}

function readStoredQuizzes(): TQuiz[] {
  if (typeof window === "undefined") return [];
  try {
    migrateQuizStorageIfNeeded();
    const raw = window.localStorage.getItem("quizzes");
    const parsed = raw ? (JSON.parse(raw) as TQuiz[]) : [];
    // Extra safety: ignore any leftover short rounds from older clients
    return parsed.filter(
      (q) =>
        Array.isArray(q.questionIds) &&
        q.questionIds.length === QUESTIONS_PER_ROUND
    );
  } catch {
    return [];
  }
}

// Brain Arena palette — works across future quiz categories
const ARENA_CORAL = "#ff5a3d";
const ARENA_TEAL = "#0f9f8a";
const ARENA_SUN = "#ffc43d";

const AGES = Array.from({ length: 88 }, (_, i) => i + 8);
const ITEM_HEIGHT = 40;
const QUESTIONS_PER_ROUND = 10;
const SECONDS_PER_QUESTION = 20;
const OPTION_LETTERS = ["A", "B", "C", "D"];
const OPTION_ACCENTS = [
  "from-[#fff0ec] to-white border-[#ff5a3d]/55",
  "from-[#e8f8f4] to-white border-[#0f9f8a]/55",
  "from-[#fff8e6] to-white border-[#ffc43d]/70",
  "from-[#eaf8fd] to-white border-[#4cc9f0]/65",
];
const OPTION_LETTER_BG = [
  "bg-[#ff5a3d] text-white",
  "bg-[#0f9f8a] text-white",
  "bg-[#ffc43d] text-[#14213d]",
  "bg-[#4cc9f0] text-[#14213d]",
];

// v2: new question bank — ignore old seen keys so stale ids don't force false repeats
const SEEN_BY_USER_KEY = "quizSeenByUser_v2";
const SEEN_GLOBAL_KEY = "quizSeenGlobal_v2";

type TQuestionBankItem = (typeof questionsJson)[number] & {
  difficulty?: "easy" | "medium" | "hard";
};

const shuffle = <T,>(items: T[]) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const normalizeUserKey = (name: string) => name.trim().toLowerCase();

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode errors
  }
}

function readSeenByUser(): Record<string, number[]> {
  return readJson<Record<string, number[]>>(SEEN_BY_USER_KEY, {});
}

function readGlobalSeen(): number[] {
  return readJson<number[]>(SEEN_GLOBAL_KEY, []);
}

/** Union of: this user's seen + every player's seen + quiz history. */
function getBlockedQuestionIds(userName: string, quizzes: TQuiz[]): number[] {
  const key = normalizeUserKey(userName);
  const byUser = readSeenByUser();
  const fromUser = key ? byUser[key] || [] : [];
  const fromAllUsers = Object.values(byUser).flat();
  const fromGlobal = readGlobalSeen();
  const fromHistory = quizzes.flatMap((q) => q.questionIds || []);
  return [...new Set([...fromUser, ...fromAllUsers, ...fromGlobal, ...fromHistory])];
}

function markQuestionsSeen(userName: string, questionIds: number[]) {
  if (questionIds.length === 0) return;

  const key = normalizeUserKey(userName);
  if (key) {
    const map = readSeenByUser();
    map[key] = [...new Set([...(map[key] || []), ...questionIds])];
    writeJson(SEEN_BY_USER_KEY, map);
  }

  writeJson(SEEN_GLOBAL_KEY, [
    ...new Set([...readGlobalSeen(), ...questionIds]),
  ]);
}

function resetAllSeenTracking() {
  writeJson(SEEN_BY_USER_KEY, {});
  writeJson(SEEN_GLOBAL_KEY, []);
}

/**
 * Pick a fresh round. Never repeats a blocked id while unused questions remain.
 * Only after the whole bank is exhausted do we reset and start a new cycle.
 */
const getRandomQuestionIds = (
  count = QUESTIONS_PER_ROUND,
  excludeIds: number[] = []
) => {
  const bank = questionsJson as TQuestionBankItem[];
  const exclude = new Set(excludeIds);
  let pool = bank.filter((q) => !exclude.has(q.id));

  // Full recycle only when not enough fresh questions left in the entire bank
  if (pool.length < count) {
    resetAllSeenTracking();
    pool = [...bank];
  }

  const byDiff = (difficulty: "easy" | "medium" | "hard") =>
    shuffle(pool.filter((q) => q.difficulty === difficulty));

  const easy = byDiff("easy");
  const medium = byDiff("medium");
  const hard = byDiff("hard");

  const wantHard = Math.min(hard.length, Math.max(2, Math.round(count * 0.25)));
  const wantEasy = Math.min(easy.length, Math.max(3, Math.round(count * 0.35)));
  const wantMedium = Math.min(
    medium.length,
    Math.max(0, count - wantHard - wantEasy)
  );

  const picked: TQuestionBankItem[] = [
    ...easy.slice(0, wantEasy),
    ...medium.slice(0, wantMedium),
    ...hard.slice(0, wantHard),
  ];

  // Fill only from the fresh pool — never sneak excluded ids back in
  if (picked.length < count) {
    const used = new Set(picked.map((q) => q.id));
    const extras = shuffle(pool.filter((q) => !used.has(q.id)));
    picked.push(...extras.slice(0, count - picked.length));
  }

  return shuffle(picked)
    .slice(0, count)
    .map((q) => q.id);
};

const pickQuestionIdsForUser = (
  userName: string,
  quizzes: TQuiz[],
  count = QUESTIONS_PER_ROUND
) => getRandomQuestionIds(count, getBlockedQuestionIds(userName, quizzes));

const formatTime = (totalSec: number) => {
  const safe = Math.max(0, totalSec);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

function Atmosphere() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      style={{ background: "#0b1526" }}
    >
      {/* Night quiz arena — coral + teal energy */}
      <div
        className="absolute -left-20 -top-24 h-[28rem] w-[28rem] rounded-full opacity-55 blur-3xl animate-[drift-a_18s_ease-in-out_infinite]"
        style={{ background: ARENA_CORAL }}
      />
      <div
        className="absolute -right-24 top-10 h-[26rem] w-[26rem] rounded-full opacity-45 blur-3xl animate-[drift-b_22s_ease-in-out_infinite]"
        style={{ background: ARENA_TEAL }}
      />
      <div
        className="absolute -bottom-28 left-1/4 h-[24rem] w-[24rem] rounded-full opacity-40 blur-3xl animate-[drift-c_20s_ease-in-out_infinite]"
        style={{ background: ARENA_SUN }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, rgba(255,255,255,0.12) 0%, transparent 50%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.55) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
    </div>
  );
}

function AgeScrollPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (age: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const ignoreScrollRef = useRef(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const idx = Math.max(0, AGES.indexOf(value));
    const top = idx * ITEM_HEIGHT;
    ignoreScrollRef.current = true;
    const sync = () => {
      el.scrollTop = top;
    };
    sync();
    const raf1 = window.requestAnimationFrame(() => {
      sync();
      const raf2 = window.requestAnimationFrame(() => {
        sync();
        ignoreScrollRef.current = false;
      });
      return raf2;
    });
    const unlock = window.setTimeout(() => {
      sync();
      ignoreScrollRef.current = false;
    }, 120);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(unlock);
    };
  }, [value]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || ignoreScrollRef.current) return;

    const rawIndex = el.scrollTop / ITEM_HEIGHT;
    const clampedIndex = Math.max(
      0,
      Math.min(AGES.length - 1, Math.round(rawIndex))
    );
    const nextAge = AGES[clampedIndex];
    if (nextAge !== value) {
      onChange(nextAge);
    }

    if (scrollTimeoutRef.current) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      ignoreScrollRef.current = true;
      el.scrollTo({
        top: clampedIndex * ITEM_HEIGHT,
        behavior: "smooth",
      });
      window.setTimeout(() => {
        ignoreScrollRef.current = false;
      }, 180);
    }, 90);
  };

  return (
    <div className="relative mx-auto w-48 select-none">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-10 -translate-y-1/2 rounded-2xl border-2 border-[#ff5a3d]/70 bg-[#ff5a3d]/10" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-[#f7f9fc] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-[#f7f9fc] to-transparent" />

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-36 overflow-y-auto scroll-smooth py-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {AGES.map((ageItem) => {
          const distance = Math.abs(ageItem - value);
          const opacity =
            distance === 0
              ? 1
              : distance === 1
                ? 0.55
                : distance === 2
                  ? 0.28
                  : 0.12;

          return (
            <button
              key={ageItem}
              type="button"
              onClick={() => {
                onChange(ageItem);
                const idx = AGES.indexOf(ageItem);
                containerRef.current?.scrollTo({
                  top: idx * ITEM_HEIGHT,
                  behavior: "smooth",
                });
              }}
              style={{ height: `${ITEM_HEIGHT}px`, opacity }}
              className={cn(
                "flex w-full cursor-pointer items-center justify-center transition-all duration-150",
                distance === 0
                  ? "scale-110 font-display text-xl font-extrabold text-coral"
                  : "text-base font-semibold text-ink-soft"
              )}
            >
              {ageItem} yrs
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CircularTimer({
  timeLeft,
  total,
}: {
  timeLeft: number;
  total: number;
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? timeLeft / total : 0;
  const urgent = timeLeft <= 15;

  return (
    <div className="relative h-16 w-16">
      {urgent && (
        <span className="absolute inset-0 rounded-full bg-coral/25 animate-pulse-ring" />
      )}
      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 72 72">
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="rgba(20,33,61,0.08)"
          strokeWidth="6"
        />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke={urgent ? "#ff5a3d" : "#0f9f8a"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="transition-[stroke-dashoffset] duration-700 ease-linear"
        />
      </svg>
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center font-display text-sm font-extrabold",
          urgent ? "text-coral" : "text-ink"
        )}
      >
        {formatTime(timeLeft)}
      </div>
    </div>
  );
}

const FUNNY_COMMENTS = {
  winner: [
    "বাপরে বাপ! ব্রেইনটা আজ পুরো চার্জড!",
    "একটাও ভুল নেই — তুমি তো ধাঁধার বস!",
    "পারফেক্ট স্কোর! এখন আয়নায় হাসো একটু।",
    "মস্তিষ্ক বলেছে: আজ ছুটি নেই, জিততে হবে!",
    "এত পারফেক্ট যে কুইজও লজ্জা পেয়েছে!",
  ],
  high: [
    "এত কাছে এসেও… আরেকটু হলেই ক্রাউন!",
    "দারুণ গেছে — জয়টা হাতের নাগালেই ছিল!",
    "আগুন লেগেছে স্কোরে, শুধু ফিনিশিংটা বাকি!",
    "মন ভালো রাখো — চ্যাম্পিয়নশিপ প্রায় তোমার!",
    "বেশ জোরে খেলেছ, পরের রাউন্ডে ফাটাও!",
  ],
  mid: [
    "না জিতেছ, না হেরেছ — ক্লাসিক মিড ভাইব!",
    "মোটামুটি চলছে… চা খেয়ে আবার আসো!",
    "মস্তিষ্ক আজ হাফ-টাইমে আছে, সেকেন্ড হাফ বাকি!",
    "এই স্কোর দেখে ধাঁধাও হাসে — আবার খেলো!",
    "মাঝামাঝি জোন! না নাটক, না কমেডি — সিক্যুয়েল চাই।",
  ],
  low: [
    "আজ মস্তিষ্ক বলেছে: আমি ঘুমাই…",
    "উফফ! স্কোরটা একটু নাটকীয় হয়ে গেছে।",
    "হাল ছাড়ো না — ধাঁধাও মানুষ, আবার মিলবে!",
    "এবারের প্লট ট্বিস্ট তুমি নও… পরের রাউন্ডে তুমিই!",
    "কান্না পরে, এখন Play again চাপো!",
  ],
} as const;

const pickFunnyComment = (pool: readonly string[]) =>
  pool[Math.floor(Math.random() * pool.length)] || pool[0];

/**
 * Messenger-style: one emoji type only.
 * Center hero stays single; copies of that same emoji float up.
 * Winner = denser float across the whole score card (still the same emoji).
 */
function EmojiFloatFX({
  emoji,
  celebrate = false,
}: {
  emoji: string;
  celebrate?: boolean;
}) {
  const bits = useMemo(() => {
    const count = celebrate ? 28 : 12;
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: celebrate ? (i * 8.1) % 100 : 28 + ((i * 17) % 44),
      size: celebrate ? 28 + (i % 5) * 6 : 30 + (i % 3) * 4,
      duration: celebrate ? 2.2 + (i % 5) * 0.5 : 2.5 + (i % 4) * 0.35,
      delay: celebrate ? (i % 10) * 0.2 : (i % 6) * 0.3,
      drift: (i % 2 === 0 ? 1 : -1) * (10 + (i % 5) * 10),
    }));
  }, [emoji, celebrate]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]"
      aria-hidden
    >
      {bits.map((b) => {
        const style: Record<string, string> = {
          left: `${b.left}%`,
          fontSize: `${b.size}px`,
          animationDuration: `${b.duration}s`,
          animationDelay: `${b.delay}s`,
          "--drift": `${b.drift}px`,
        };
        return (
          <span
            key={`${emoji}-${b.id}`}
            style={style}
            className={cn(
              "absolute select-none",
              celebrate
                ? "bottom-[-6%] animate-emoji-float-party"
                : "bottom-[8%] animate-emoji-float"
            )}
          >
            {emoji}
          </span>
        );
      })}
    </div>
  );
}

export default function Quiz() {
  const [name, setName] = useState("");
  const [age, setAge] = useState<number>(18);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  // Start empty on server + first client paint to avoid hydration mismatch / blank screen
  const [quizzes, setQuizzesState] = useState<TQuiz[]>([]);
  const [ready, setReady] = useState(false);
  const [showFx, setShowFx] = useState(false);
  const [submitWarning, setSubmitWarning] = useState("");
  const [timeLeft, setTimeLeft] = useState<number>(0);
  // Session UI only — never resume mid-quiz / old scoreboard after refresh
  const [screen, setScreen] = useState<TScreen>("start");
  const [activeQuizId, setActiveQuizId] = useState<number | null>(null);
  const ignorePopRef = useRef(false);

  const persistQuizzes = (value: TQuiz[]) => {
    try {
      window.localStorage.setItem("quizzes", JSON.stringify(value));
    } catch {
      // ignore quota / private mode errors
    }
  };

  const setQuizzes = (next: TQuiz[] | ((prev: TQuiz[]) => TQuiz[])) => {
    setQuizzesState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      persistQuizzes(value);
      return value;
    });
  };

  const goFrontPage = (opts?: { clearPlayer?: boolean }) => {
    const clearPlayer = opts?.clearPlayer !== false;
    setAnswers({});
    setSubmitWarning("");
    setShowFx(false);
    setTimeLeft(0);
    setScreen("start");
    setActiveQuizId(null);
    if (clearPlayer) {
      setName("");
      setAge(18);
    }
    setQuizzesState((prev) => {
      const next = prev
        .map((q) =>
          q.status === "running" ? { ...q, status: "done" as const } : q
        )
        .filter((q) => q.status === "done");
      persistQuizzes(next);
      return next;
    });
  };

  useEffect(() => {
    // Cold load / refresh → always name+age front page (keep done history for anti-repeat)
    const stored = readStoredQuizzes().map((q) =>
      q.status === "running" ? { ...q, status: "done" as const } : q
    );
    const historyOnly = stored.filter((q) => q.status === "done");
    persistQuizzes(historyOnly);
    setQuizzesState(historyOnly);
    setScreen("start");
    setActiveQuizId(null);
    setAnswers({});
    setShowFx(false);
    setSubmitWarning("");
    setTimeLeft(0);

    ignorePopRef.current = true;
    window.history.replaceState(
      { quizScreen: "start" },
      "",
      window.location.pathname + window.location.search
    );
    window.setTimeout(() => {
      ignorePopRef.current = false;
    }, 0);

    setReady(true);
  }, []);

  // Chrome/browser Back → quiz front page (NOT in-quiz question Back)
  useEffect(() => {
    const onPopState = () => {
      if (ignorePopRef.current) return;
      goFrontPage({ clearPlayer: true });
      ignorePopRef.current = true;
      window.history.replaceState(
        { quizScreen: "start" },
        "",
        window.location.pathname + window.location.search
      );
      window.setTimeout(() => {
        ignorePopRef.current = false;
      }, 0);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const pushScreen = (quizScreen: TScreen, quizId: number) => {
    window.history.pushState(
      { quizScreen, quizId },
      "",
      window.location.pathname + window.location.search
    );
  };

  const replaceScreen = (quizScreen: TScreen, quizId?: number) => {
    window.history.replaceState(
      { quizScreen, quizId },
      "",
      window.location.pathname + window.location.search
    );
  };

  const quiz = useMemo(() => {
    if ((screen === "running" || screen === "done") && activeQuizId != null) {
      const activeQuiz = quizzes.find((q) => q.id === activeQuizId);
      if (activeQuiz) return activeQuiz;
    }

    const pendingQuiz: TQuiz = {
      id: Date.now(),
      date: new Date(),
      examinee: { name: "" },
      optionIds: [],
      status: "pending",
      questionIndex: 0,
      questionIds: getRandomQuestionIds(),
    };
    return pendingQuiz;
  }, [quizzes, screen, activeQuizId]);

  const questions = useMemo(() => {
    return quiz.questionIds
      .map((id) => (questionsJson as TQuestion[]).find((q) => q.id === id))
      .filter((q): q is TQuestion => Boolean(q));
  }, [quiz.questionIds]);

  const question = questions[quiz.questionIndex];
  const isStartValid = name.trim().length > 0;

  const totalTimeSec =
    quiz.timeLimitSec || Math.max(30, questions.length * SECONDS_PER_QUESTION);

  const unansweredCount = useMemo(() => {
    return questions.filter((q) => answers[q.id] === undefined).length;
  }, [questions, answers]);

  const allAnswered = unansweredCount === 0;

  const timerArmedRef = useRef(false);

  const updateQuiz = (updatedQuiz: Partial<TQuiz>) => {
    setQuizzes((prev) => {
      const exists = prev.some((item) => item.id === quiz.id);
      if (!exists) {
        return [{ ...quiz, ...updatedQuiz }, ...prev];
      }
      return prev.map((item) =>
        item.id === quiz.id ? { ...item, ...updatedQuiz } : item
      );
    });
  };

  const finalizeQuiz = (force = false) => {
    if (!force && !allAnswered) {
      setSubmitWarning(
        `সব প্রশ্ন শেষ করো (${unansweredCount}টা বাকি), তারপর Submit।`
      );
      return;
    }

    setSubmitWarning("");
    const computedResults: TResultItem[] = questions.map((q) => {
      const selectedOptionId = answers[q.id];
      return {
        ...q,
        optionId: selectedOptionId,
        isRight:
          selectedOptionId !== undefined && q.rightAnswer === selectedOptionId,
      };
    });

    updateQuiz({
      status: "done",
      results: computedResults,
    });
    setScreen("done");
    // Replace "running" history entry so browser Back skips mid-quiz → front page
    replaceScreen("done", quiz.id);
  };

  useEffect(() => {
    if (screen !== "running") {
      timerArmedRef.current = false;
      return;
    }

    setTimeLeft(totalTimeSec);
    timerArmedRef.current = false;
    const armId = window.setTimeout(() => {
      timerArmedRef.current = true;
    }, 50);

    const interval = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearTimeout(armId);
      window.clearInterval(interval);
    };
  }, [screen, quiz.id, totalTimeSec]);

  useEffect(() => {
    if (
      screen === "running" &&
      timeLeft === 0 &&
      timerArmedRef.current &&
      questions.length > 0
    ) {
      finalizeQuiz(true);
    }
  }, [timeLeft, screen]);

  useEffect(() => {
    if (screen !== "done") {
      setShowFx(false);
      return;
    }
    setShowFx(true);
    const timer = window.setTimeout(
      () => setShowFx(false),
      // winner party floats a bit longer across the whole score card
      16000
    );
    return () => window.clearTimeout(timer);
  }, [screen, quiz.id]);

  const onStartQuiz = () => {
    const cleanName = name.trim() || "Player";
    const randomIds = pickQuestionIdsForUser(cleanName, quizzes);
    const limitSec = Math.max(30, randomIds.length * SECONDS_PER_QUESTION);

    setAnswers({});
    setSubmitWarning("");
    setShowFx(false);
    setTimeLeft(limitSec);
    markQuestionsSeen(cleanName, randomIds);

    const newQuiz: TQuiz = {
      id: Date.now(),
      date: new Date(),
      examinee: {
        name: cleanName,
        age,
      },
      optionIds: [],
      status: "running",
      questionIndex: 0,
      questionIds: randomIds,
      timeLimitSec: limitSec,
    };

    // Keep past rounds so repeats stay off for this player
    setQuizzes((prev) => [
      newQuiz,
      ...prev.filter((q) => q.status !== "running" && q.status !== "pending"),
    ]);
    setActiveQuizId(newQuiz.id);
    setScreen("running");
    pushScreen("running", newQuiz.id);
  };

  const onPlayAgainSamePlayer = () => {
    const prevExaminee = quiz.examinee?.name
      ? quiz.examinee
      : {
          name: name.trim() || "Player",
          age,
        };

    const randomIds = pickQuestionIdsForUser(prevExaminee.name, quizzes);
    const limitSec = Math.max(30, randomIds.length * SECONDS_PER_QUESTION);

    setAnswers({});
    setSubmitWarning("");
    setShowFx(false);
    setTimeLeft(limitSec);
    markQuestionsSeen(prevExaminee.name, randomIds);

    const newQuiz: TQuiz = {
      id: Date.now(),
      date: new Date(),
      examinee: prevExaminee,
      optionIds: [],
      status: "running",
      questionIndex: 0,
      questionIds: randomIds,
      timeLimitSec: limitSec,
    };

    setQuizzes((prev) => [
      newQuiz,
      ...prev.map((q) =>
        q.status === "running" ? { ...q, status: "done" as const } : q
      ),
    ]);
    setActiveQuizId(newQuiz.id);
    setScreen("running");
    pushScreen("running", newQuiz.id);
  };

  const onRestartToStartScreen = () => {
    goFrontPage({ clearPlayer: true });
    replaceScreen("start");
  };

  const results = quiz.results || [];
  const wrongResults = results.filter((r) => !r.isRight);
  const correctCount = results.filter((r) => r.isRight).length;
  const totalCount = questions.length;
  const scorePercent =
    totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  const reaction = useMemo(() => {
    // Fresh funny line each finished quiz (keyed by quiz.id)
    void quiz.id;

    if (totalCount > 0 && correctCount === totalCount) {
      return {
        emoji: "🏆",
        comment: pickFunnyComment(FUNNY_COMMENTS.winner),
        celebrate: true,
        panelClass:
          "from-[#fff4d6] via-white to-[#d8f3e8] border-[#ffc43d] shadow-[0_10px_0_0_rgba(224,168,32,0.35)]",
        scoreClass: "text-[#ff5a3d]",
      };
    }
    if (scorePercent >= 70) {
      return {
        emoji: "🔥",
        comment: pickFunnyComment(FUNNY_COMMENTS.high),
        celebrate: false,
        panelClass: "from-[#dff6fd] via-white to-[#e8f8f4] border-[#0f9f8a]/55",
        scoreClass: "text-teal-deep",
      };
    }
    if (scorePercent >= 40) {
      return {
        emoji: "😅",
        comment: pickFunnyComment(FUNNY_COMMENTS.mid),
        celebrate: false,
        panelClass: "from-[#fff6df] via-white to-[#eaf8fd] border-[#ffc43d]/55",
        scoreClass: "text-ink",
      };
    }
    return {
      emoji: "😢",
      comment: pickFunnyComment(FUNNY_COMMENTS.low),
      celebrate: false,
      panelClass: "from-[#ffe8e0] via-white to-[#dff6fd] border-[#ff5a3d]/45",
      scoreClass: "text-coral-deep",
    };
  }, [correctCount, totalCount, scorePercent, quiz.id]);

  if (!ready) {
    return (
      <div
        className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden"
        style={{ background: "#0b1526" }}
      >
        <Atmosphere />
        <p className="relative z-10 font-display text-3xl font-extrabold text-white drop-shadow-lg">
          Quiz <span style={{ color: "#ffc43d" }}>Test</span>
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-dvh w-full overflow-hidden"
      style={{ background: "#0b1526" }}
    >
      <Atmosphere />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
        {/* Brand — scalable quiz shell for future categories */}
        <header
          className={cn(
            "text-center",
            screen === "start" ? "mb-8 sm:mb-10" : "mb-5"
          )}
        >
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/90 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff5a3d]" />
            GK · Brain Twist
          </p>
          <h1
            className={cn(
              "font-display font-extrabold tracking-tight text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.25)]",
              screen === "start"
                ? "text-5xl sm:text-7xl"
                : "text-3xl sm:text-4xl"
            )}
          >
            Quiz <span className="text-[#ffc43d]">Test</span>
          </h1>
          {screen === "start" && (
            <p className="mx-auto mt-3 max-w-md text-base font-semibold text-white/80 sm:text-lg">
              সাধারণ জ্ঞানের মজার ধাঁধা — টাইমার চালু, মস্তিষ্ক গরম করো।
            </p>
          )}
        </header>

        <div className="rounded-[1.75rem] border border-white/20 bg-white/95 p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)] backdrop-blur-sm sm:p-7">
          {/* 1. Start Screen */}
          {screen === "start" && (
            <section key="start" className="space-y-6">
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#3d4a66]">
                  Your name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isStartValid) onStartQuiz();
                  }}
                  placeholder="e.g. Rezwana"
                  className="w-full rounded-2xl border-2 border-[#14213d]/15 bg-[#f7f9fc] px-5 py-4 text-lg font-semibold text-[#14213d] shadow-[0_6px_0_0_rgba(20,33,61,0.08)] outline-none transition placeholder:font-medium placeholder:text-[#14213d]/35 focus:border-[#ff5a3d] focus:bg-white focus:shadow-[0_6px_0_0_rgba(255,90,61,0.2)]"
                />
              </div>

              <div className="rounded-[1.5rem] border-2 border-[#14213d]/10 bg-[#f7f9fc] px-4 py-5 text-center">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[#3d4a66]">
                  Scroll your age
                </div>
                <AgeScrollPicker value={age} onChange={setAge} />
              </div>

              <Button
                onClick={onStartQuiz}
                disabled={!isStartValid}
                className="w-full py-4 text-lg"
              >
                Start quiz →
              </Button>
            </section>
          )}

          {/* 2. Running Screen */}
          {screen === "running" && question && (
            <section key={`q-${question.id}-${quiz.questionIndex}`}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#14213d]/10 bg-[#f7f9fc] px-3 py-1.5 text-sm font-semibold text-ink">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#ff5a3d] to-[#ffc43d] text-xs font-extrabold text-white">
                    {(quiz.examinee?.name || name || "P").charAt(0).toUpperCase()}
                  </span>
                  <span>{quiz.examinee?.name || name || "Player"}</span>
                  {quiz.examinee?.age && (
                    <span className="text-ink-soft">· {quiz.examinee.age}</span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden text-right sm:block">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                      Question
                    </div>
                    <div className="font-display text-lg font-extrabold text-ink">
                      {quiz.questionIndex + 1}
                      <span className="text-ink/35">/{questions.length}</span>
                    </div>
                  </div>
                  <CircularTimer timeLeft={timeLeft} total={totalTimeSec} />
                </div>
              </div>

              <div className="mb-6 flex gap-1.5">
                {questions.map((q, i) => {
                  const answered = answers[q.id] !== undefined;
                  const current = i === quiz.questionIndex;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      title={`Question ${i + 1}${answered ? " ✓" : ""}`}
                      onClick={() => {
                        setSubmitWarning("");
                        updateQuiz({ questionIndex: i });
                      }}
                      className={cn(
                        "h-2.5 flex-1 rounded-full transition-all duration-300 cursor-pointer",
                        current
                          ? "scale-y-125 bg-[#ff5a3d] shadow-[0_0_0_2px_rgba(255,90,61,0.25)]"
                          : answered
                            ? "bg-[#0f9f8a]"
                            : "bg-[#14213d]/15 hover:bg-[#14213d]/30"
                      )}
                    />
                  );
                })}
              </div>

              {question.difficulty === "hard" && (
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white shadow-[0_4px_0_0_#c73a22]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
                  Brain twist
                </div>
              )}
              {question.difficulty === "medium" && (
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-sun/90 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink">
                  Think twice
                </div>
              )}

              <h2 className="font-display text-2xl font-extrabold leading-snug tracking-tight text-ink sm:text-3xl">
                {question.title}
              </h2>

              <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {question.options.map((option, idx) => {
                  const isSelected = answers[question.id] === option.id;
                  return (
                    <li
                      key={option.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSubmitWarning("");
                          setAnswers({ ...answers, [question.id]: option.id });
                        }
                      }}
                      onClick={() => {
                        setSubmitWarning("");
                        setAnswers({
                          ...answers,
                          [question.id]: option.id,
                        });
                      }}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-3.5 rounded-2xl border-[3px] bg-gradient-to-br p-4 text-base font-bold transition-all duration-200",
                        isSelected
                          ? "scale-[1.03] border-[#14213d] from-white to-[#e8eef8] shadow-[0_8px_0_0_rgba(20,33,61,0.28)] ring-4 ring-[#ffc43d]/55"
                          : cn(
                              OPTION_ACCENTS[idx % OPTION_ACCENTS.length],
                              "shadow-[0_6px_0_0_rgba(0,0,0,0.12)] hover:scale-[1.01] hover:shadow-[0_8px_0_0_rgba(0,0,0,0.16)]",
                              answers[question.id] !== undefined &&
                                "opacity-55"
                            )
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-11 w-11 flex-none items-center justify-center rounded-full font-display text-sm font-extrabold shadow-[inset_0_-3px_0_rgba(0,0,0,0.2)] ring-2 ring-white/70 transition-colors",
                          isSelected
                            ? "bg-[#14213d] text-[#ffc43d] ring-[#ffc43d]/80"
                            : OPTION_LETTER_BG[idx % OPTION_LETTER_BG.length]
                        )}
                      >
                        {isSelected ? "✓" : OPTION_LETTERS[idx] || idx + 1}
                      </span>
                      <span
                        className={cn(
                          "flex-1 leading-snug",
                          isSelected ? "text-[#14213d]" : "text-ink"
                        )}
                      >
                        {option.title}
                      </span>
                      {isSelected && (
                        <span className="absolute right-3 top-3 rounded-full bg-[#ffc43d] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#14213d] shadow-[0_2px_0_0_rgba(224,168,32,0.55)]">
                          Selected
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {submitWarning && (
                <div className="mt-4 rounded-2xl border-2 border-[#ffc43d] bg-[#ffc43d]/35 px-4 py-3 text-sm font-bold text-[#14213d]">
                  {submitWarning}
                </div>
              )}

              {!allAnswered &&
                quiz.questionIndex === questions.length - 1 &&
                !submitWarning && (
                  <div className="mt-4 text-center text-sm font-semibold text-[#3d4a66]">
                    আরও {unansweredCount}টা প্রশ্ন বাকি — Back দিয়ে পূরণ করো, তারপর Submit
                  </div>
                )}

              <div className="mt-8 flex items-center justify-between gap-3">
                <div>
                  {quiz.questionIndex !== 0 && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSubmitWarning("");
                        updateQuiz({ questionIndex: quiz.questionIndex - 1 });
                      }}
                    >
                      ← Back
                    </Button>
                  )}
                </div>

                {quiz.questionIndex < questions.length - 1 ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (answers[question.id] === undefined) {
                        setSubmitWarning("আগে এই প্রশ্নের উত্তর বাছাই করো, তারপর Next।");
                        return;
                      }
                      setSubmitWarning("");
                      updateQuiz({ questionIndex: quiz.questionIndex + 1 });
                    }}
                  >
                    Next →
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      if (!allAnswered) {
                        // jump to first unanswered
                        const firstUnanswered = questions.findIndex(
                          (q) => answers[q.id] === undefined
                        );
                        setSubmitWarning(
                          `সব প্রশ্ন শেষ করো (${unansweredCount}টা বাকি)।`
                        );
                        if (firstUnanswered >= 0) {
                          updateQuiz({ questionIndex: firstUnanswered });
                        }
                        return;
                      }
                      finalizeQuiz(false);
                    }}
                    className={cn(!allAnswered && "opacity-90")}
                  >
                    Submit score
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* 3. Results */}
          {screen === "done" && (
            <section key="done" className="space-y-5">
              <div
                className={cn(
                  "relative overflow-hidden rounded-[1.75rem] border-2 bg-gradient-to-br p-6 text-center sm:p-8",
                  reaction.panelClass
                )}
              >
                {showFx && (
                  <EmojiFloatFX
                    emoji={reaction.emoji}
                    celebrate={reaction.celebrate}
                  />
                )}

                <div className="relative z-10 mx-auto mb-1 flex h-24 items-center justify-center sm:h-28">
                  <span className="animate-soft-float select-none text-6xl sm:text-7xl">
                    {reaction.emoji}
                  </span>
                </div>

                <div className="relative z-10 text-sm font-semibold text-ink-soft">
                  <span className="font-bold text-ink">
                    {quiz.examinee?.name || "Player"}
                  </span>
                  {quiz.examinee?.age && (
                    <span> · {quiz.examinee.age} yrs</span>
                  )}
                </div>

                <div
                  className={cn(
                    "relative z-10 mt-2 font-display text-6xl font-extrabold tracking-tight sm:text-7xl",
                    reaction.scoreClass
                  )}
                >
                  {correctCount}
                  <span className="text-ink/25">/{totalCount}</span>
                </div>

                <div className="relative z-10 mt-1 text-xs font-bold uppercase tracking-[0.2em] text-ink-soft">
                  {scorePercent}%
                </div>

                <p className="relative z-10 mx-auto mt-3 max-w-sm text-sm font-semibold text-ink-soft">
                  {reaction.comment}
                </p>

                <div className="relative z-10 mx-auto mt-5 h-3 max-w-xs overflow-hidden rounded-full bg-white/50">
                  <div
                    style={{ width: `${scorePercent}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-coral via-sun to-teal"
                  />
                </div>
              </div>

              {wrongResults.length > 0 && (
                <div className="max-h-64 space-y-2.5 overflow-y-auto pr-1">
                  {wrongResults.map((item) => {
                    const chosenTitle = item.options.find(
                      (o) => o.id === item.optionId
                    )?.title;
                    const rightTitle = item.options.find(
                      (o) => o.id === item.rightAnswer
                    )?.title;

                    return (
                      <div
                        key={item.id}
                        className="rounded-2xl border-2 border-coral/25 bg-white/75 p-4 text-sm backdrop-blur"
                      >
                        <div className="font-bold text-ink">{item.title}</div>
                        <div className="mt-1.5 text-xs font-semibold text-coral">
                          <span className="line-through opacity-80">
                            {chosenTitle || "—"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs font-bold text-teal-deep">
                          {rightTitle}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                <Button onClick={onPlayAgainSamePlayer} className="flex-1">
                  Play again
                </Button>
                <Button
                  variant="ghost"
                  onClick={onRestartToStartScreen}
                  className="flex-1"
                >
                  Change player
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
