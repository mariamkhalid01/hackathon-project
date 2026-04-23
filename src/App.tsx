/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CircleDot, 
  Settings,
  History,
  ShieldAlert,
  Info,
  Loader2,
  Lightbulb,
  RotateCcw
} from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// Types for our "Alchemy" objects
type Article = 'DER' | 'DIE' | 'DAS';
type ObjectState = 'IDLE' | 'STABILIZING' | 'GUESSING' | 'RESULT';
type DifficultyLevel = 1 | 2 | 3;

interface AlchemyObject {
  id: string;
  name: string;
  article: Article;
  level: DifficultyLevel;
  explanation?: string;
}

// COCO to German Article Mapping with Levels
const OBJECT_MAP: Record<string, AlchemyObject> = {
  // LEVEL 1: Common items + Endings
  'person': { id: 'person', name: 'Mensch', article: 'DER', level: 1, explanation: 'Hint Type: Category\nHint: "Living male or unspecified humans are 90% DER — he\'s the star of the show!"' },
  'chair': { id: 'chair', name: 'Stuhl', article: 'DER', level: 1, explanation: 'Hint Type: Category\nHint: "Furniture items ending in consonants are often DER — think of it as a strong, solid seat."' },
  'bottle': { id: 'bottle', name: 'Flasche', article: 'DIE', level: 1, explanation: 'Hint Type: Suffix\nHint: "Check the tail! Words ending in -e are 90% chance DIE — like a flowing, elegant wave."' },
  'cup': { id: 'cup', name: 'Tasse', article: 'DIE', level: 1, explanation: 'Hint Type: Suffix\nHint: "Look at that -e ending! It’s a classic sign for DIE — most small drinking containers follow this path."' },
  'laptop': { id: 'laptop', name: 'Laptop', article: 'DAS', level: 1, explanation: 'Hint Type: Category\nHint: "Tech words and modern loanwords are almost always DAS — keep it neutral and digital!"' },
  'cell phone': { id: 'cell phone', name: 'Handy', article: 'DAS', level: 1, explanation: 'Hint Type: Category\nHint: "Most foreign imports in the tech world settle into the DAS category — convenient and neutral!"' },
  'backpack': { id: 'backpack', name: 'Rucksack', article: 'DER', level: 1, explanation: 'Hint Type: Arabic Bridge\nHint: "Careful! In Arabic, شنطة is feminine, but in German DER Rucksack is masculine — imagine carrying a heavy stone on your back!"' },
  
  // LEVEL 2: Everyday Items & Ending Rules
  'remote': { id: 'remote', name: 'Fernbedienung', article: 'DIE', level: 2, explanation: 'Hint Type: Suffix\nHint: "Check the tail! Words ending in -ung are 100% DIE — they are action words in motion."' },
  'tv': { id: 'tv', name: 'Fernseher', article: 'DER', level: 2, explanation: 'Hint Type: Suffix\nHint: "The -er ending is a major clue for DER — think of it as a person or a tool doing a job."' },
  'keyboard': { id: 'keyboard', name: 'Tastatur', article: 'DIE', level: 2, explanation: 'Hint Type: Suffix\nHint: "Watch for the -ur tail! It’s a 100% DIE indicator — elegant and consistent."' },
  'suitcase': { id: 'suitcase', name: 'Koffer', article: 'DER', level: 2, explanation: 'Hint Type: Suffix\nHint: "Objects ending in -er are usually DER — imagine a strong traveler carrying his case."' },
  'clock': { id: 'clock', name: 'Uhr', article: 'DIE', level: 2, explanation: 'Hint Type: Category\nHint: "Most time-keeping instruments are DIE — think of the constant, feminine flow of time."' },
  'fork': { id: 'fork', name: 'Gabel', article: 'DIE', level: 2, explanation: 'Hint Type: Suffix\nHint: "Suffix -el on kitchen items often points to DIE — it’s a sharp, feminine choice!"' },
  'spoon': { id: 'spoon', name: 'Löffel', article: 'DER', level: 2, explanation: 'Hint Type: Suffix\nHint: "The -el ending here leans towards DER — most masculine kitchen tools share this tail."' },
  'knife': { id: 'knife', name: 'Messer', article: 'DAS', level: 2, explanation: 'Hint Type: Suffix\nHint: "Wait! Instruments ending in -er are usually DER, but the sharp Messer is a neutral DAS — quite a special exception!"' },

  // LEVEL 3: Arabic vs German Genders
  'book': { id: 'book', name: 'Buch', article: 'DAS', level: 3, explanation: 'Hint Type: Arabic Bridge\nHint: "In Arabic, Kitab is masculine, but in German DAS Buch is neutral — think of a balanced book on a shelf."' },
  'car': { id: 'car', name: 'Auto', article: 'DAS', level: 3, explanation: 'Hint Type: Arabic Bridge\nHint: "Arabic says Sayyarah is feminine, but German DAS Auto is neutral — imagine a robotic self-driving machine."' },
  'apple': { id: 'apple', name: 'Apfel', article: 'DER', level: 3, explanation: 'Hint Type: Category\nHint: "Most fruits are DIE, but DER Apfel is the king of the basket 👑 — don’t forget this special one!"' },
  'mouse': { id: 'mouse', name: 'Maus', article: 'DIE', level: 3, explanation: 'Hint Type: Arabic Bridge\nHint: "Arabic sees the mouse as masculine (Fa\'r), but in German DIE Maus is feminine — imagine a tiny ballerina mouse."' },
  'cat': { id: 'cat', name: 'Katze', article: 'DIE', level: 3, explanation: 'Hint Type: Arabic Bridge\nHint: "Arabic Qitt is masculine, but DIVINE Katze is always DIE — imagine an elegant queen cat."' },
};

const SUCCESS_SLANG = [
  "يا واد يا جامد! أيوة كدة!",
  "أيوة بقا يا حِريف.. جِبتها!",
  "عاش يا بطل! جدي فخور بيك!",
  "لوز اللوز يا معلم.. برنس والله",
  "إيه الحلاوة دي؟ انت أكيد شارب زيت زيتون!",
  "كومبو يا برنس! النقاط بتطير!"
];

const FAILURE_SLANG = [
  "قربت قوي! حاول تاني يا بطل",
  "بسيطة، ركز في القاعدة دي وهتجيبها",
  "معلش، كمل وهتكون أحسن المرة الجاية",
  "انت قدها، بص على الملحوظة دي هتساعدك",
  "محاولة كويسة، اتعلم منها وكمل طريقك"
];

const TIMEOUT_SLANG = [
  "الوقت سرقنا! ركز المرة الجاية يا فنان",
  "الوقت خلص، بس لسه عندك فرصة تانية",
  "محتاجين سرعة الكيميا.. جرب تاني بقوة",
  "خلصنا يا بطل، شد حيلك في اللي جاي",
  "عايزين سرعة شوية، ركز وهتحصلنا"
];

export default function App() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ObjectState>('IDLE');
  const stateRef = useRef<ObjectState>('IDLE');
  
  // Sync state to ref for detection loop
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [detectedObject, setDetectedObject] = useState<AlchemyObject | null>(null);
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [predictions, setPredictions] = useState<cocoSsd.DetectedObject[]>([]);
  const [videoReady, setVideoReady] = useState(false);
  const [userGuess, setUserGuess] = useState<Article | null>(null);
  const [slangMessage, setSlangMessage] = useState<string>('');
  const [showHint, setShowHint] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [timeLeft, setTimeLeft] = useState(20);
  const [lockProgress, setLockProgress] = useState(0);
  const [bestGuessLabel, setBestGuessLabel] = useState<string>('');
  
  // Game Stats
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [currentLevel, setCurrentLevel] = useState<DifficultyLevel>(1);
  const levelRef = useRef<DifficultyLevel>(1);
  useEffect(() => { levelRef.current = currentLevel; }, [currentLevel]);

  const [isComboActive, setIsComboActive] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number | null>(null);
  const lastDetectTime = useRef<number>(0);

  // Stability Tracking
  const stabilityRef = useRef<{ class: string; startTime: number; lastSeen: number }>({ class: '', startTime: 0, lastSeen: 0 });

  // Load Model
  useEffect(() => {
    async function init() {
      try {
        await tf.ready();
        const loadedModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        setModel(loadedModel);
        
        let mediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { 
              facingMode: 'environment',
              width: { ideal: 640 },
              height: { ideal: 480 } 
            },
            audio: false
          });
        } catch (e) {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
        
        setStream(mediaStream);
      } catch (err) {
        console.error(err);
        setError('Optics Initialization Failed. Check camera permissions.');
      } finally {
        setIsInitializing(false);
      }
    }
    init();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // Timer Effect
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (state === 'GUESSING' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
             setIsCorrect(false);
             setSlangMessage(TIMEOUT_SLANG[Math.floor(Math.random() * TIMEOUT_SLANG.length)]);
             setState('RESULT');
             return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [state, timeLeft === 0]);

  // Sync stream to video element
  useEffect(() => {
    let active = true;
    const video = videoRef.current;
    
    if (video && stream) {
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.play().catch(e => {
        if (active && e.name !== 'AbortError') {
          console.error("Video play failed:", e);
        }
      });
    }

    return () => { active = false; };
  }, [stream]);

  // Detection Loop (Mobile Optimized)
  const detect = useCallback(async () => {
    if (stateRef.current !== 'IDLE' && stateRef.current !== 'STABILIZING') {
      requestRef.current = requestAnimationFrame(detect);
      return;
    }

    if (!model || !videoRef.current || videoRef.current.readyState < 2) {
      requestRef.current = requestAnimationFrame(detect);
      return;
    }

    const now = Date.now();
    if (now - lastDetectTime.current < 250) {
      requestRef.current = requestAnimationFrame(detect);
      return;
    }
    lastDetectTime.current = now;

    const currentPredictions = await model.detect(videoRef.current);
    
    if (stateRef.current !== 'IDLE' && stateRef.current !== 'STABILIZING') {
      requestRef.current = requestAnimationFrame(detect);
      return;
    }

    setPredictions(currentPredictions);

    const bestTarget = currentPredictions
      .filter(p => {
        const obj = OBJECT_MAP[p.class];
        return obj && obj.level <= levelRef.current && p.score > 0.35;
      })
      .sort((a, b) => b.score - a.score)[0];

    if (bestTarget) {
      setBestGuessLabel(OBJECT_MAP[bestTarget.class].name);
      
      if (stabilityRef.current.class === bestTarget.class) {
        stabilityRef.current.lastSeen = now;
        const duration = now - stabilityRef.current.startTime;
        
        if (duration >= 2000) { // Reduced to 2s for faster feel
          const info = OBJECT_MAP[bestTarget.class];
          stateRef.current = 'GUESSING';
          setState('GUESSING');
          
          setDetectedObject({
            ...info,
            id: Math.random().toString(),
          });
          
          setTimeLeft(20);
          setUserGuess(null);
          setIsCorrect(null);
          setSlangMessage('');
          setLockProgress(0);
          setBestGuessLabel('');
          stabilityRef.current = { class: '', startTime: 0, lastSeen: 0 };
        } else {
          const progress = Math.min(Math.round((duration / 2000) * 100), 100);
          setLockProgress(progress);
          if (stateRef.current === 'IDLE' && duration > 200) {
             stateRef.current = 'STABILIZING';
             setState('STABILIZING');
          }
        }
      } else {
        if (now - stabilityRef.current.lastSeen > 800) {
          stabilityRef.current = { class: bestTarget.class, startTime: now, lastSeen: now };
          setLockProgress(0);
          if (stateRef.current === 'STABILIZING') {
             stateRef.current = 'IDLE';
             setState('IDLE');
          }
        }
      }
    } else {
      setBestGuessLabel('');
      if (stabilityRef.current.class && now - stabilityRef.current.lastSeen > 1000) {
        if (stateRef.current === 'STABILIZING') {
           stateRef.current = 'IDLE';
           setState('IDLE');
        }
        setLockProgress(0);
        stabilityRef.current = { class: '', startTime: 0, lastSeen: 0 };
      }
    }

    requestRef.current = requestAnimationFrame(detect);
  }, [model]);

  useEffect(() => {
    if (model) {
      requestRef.current = requestAnimationFrame(detect);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
  }, [model, detect]);

  const handleGuess = (guess: Article) => {
    if (!detectedObject) return;
    
    const correct = guess === detectedObject.article;
    setIsCorrect(correct);
    setUserGuess(guess);
    
    if (correct) {
      // Calculate points (10 points per correct answer as requested)
      const basePoints = 10;
      const streakMultiplier = Math.floor(streak / 3) >= 1 ? 2 : 1; 
      const gainedPoints = basePoints * streakMultiplier;
      
      setPoints(prev => {
        const currentPoints = isNaN(prev) ? 0 : prev;
        const newTotal = currentPoints + gainedPoints;
        // Level Unlock Logic
        if (newTotal >= 150) setCurrentLevel(3);
        else if (newTotal >= 50) setCurrentLevel(2);
        return newTotal;
      });
      setStreak(prev => prev + 1);
      
      if ((streak + 1) % 3 === 0) setIsComboActive(true);
      else setIsComboActive(false);

      const messages = SUCCESS_SLANG;
      setSlangMessage(messages[Math.floor(Math.random() * messages.length)]);
    } else {
      setStreak(0);
      setIsComboActive(false);
      // Only set slang message, hint is now manual via lightbulb
      const failSlang = FAILURE_SLANG[Math.floor(Math.random() * FAILURE_SLANG.length)];
      setSlangMessage(failSlang);
    }
    
    setState('RESULT');
  };

  const reset = () => {
    setState('IDLE');
    setDetectedObject(null);
    setUserGuess(null);
    setIsCorrect(null);
    setSlangMessage('');
    setShowHint(false);
    setTimeLeft(20);
    setLockProgress(0);
    setBestGuessLabel('');
  };

  const tryAgain = () => {
    setUserGuess(null);
    setIsCorrect(null);
    setSlangMessage('');
    setShowHint(false);
    setTimeLeft(20);
    setState('GUESSING');
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-cyan-400 font-sans p-8 border-[10px] sm:border-[20px] border-[#111]">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <div className="text-[10px] sm:text-[12px] tracking-[4px] sm:tracking-[8px] uppercase font-bold text-center">Initializing Neural Core...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-red-500 font-sans p-8 text-center border-[10px] sm:border-[20px] border-[#111]">
        <div className="max-w-md space-y-4">
          <ShieldAlert className="w-16 h-16 mx-auto mb-4" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase">Permission Failure</h1>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-[#050505] overflow-hidden font-sans text-white border-[10px] sm:border-[20px] border-[#111]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1a1a2e_0%,#050505_100%)] opacity-80" />

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={() => setVideoReady(true)}
        className="absolute inset-0 w-full h-full object-cover opacity-60"
      />

      <header className="absolute top-8 sm:top-12 left-1/2 -translate-x-1/2 text-center z-10 pointer-events-none w-full px-4">
        <div className="text-[10px] sm:text-[14px] tracking-[6px] sm:tracking-[12px] uppercase opacity-50 font-bold mb-1">
          DEUTSCH LENS // MOBILE CORE
        </div>
        <div className="text-3xl sm:text-5xl font-extrabold italic bg-[linear-gradient(to_right,#fff,#444)] bg-clip-text text-transparent mb-4">
          DEUTSCH LENS
        </div>
        
        {/* Game Stats Bar */}
        <div className="flex items-center justify-center gap-4 sm:gap-12">
          <div className="flex flex-col items-center">
            <span className="text-[8px] tracking-[4px] uppercase opacity-40">Expert Points</span>
            <span className="text-xl font-bold text-cyan-400">{points}</span>
          </div>
          <div className="h-8 w-[1px] bg-white/10" />
          <motion.div 
            animate={isComboActive ? { scale: [1, 1.1, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1 }}
            className="flex flex-col items-center"
          >
            <span className="text-[8px] tracking-[4px] uppercase opacity-40">Streak</span>
            <span className={`text-xl font-bold ${streak >= 3 ? 'text-orange-400' : 'text-white'}`}>
              {streak}x {streak >= 3 && '🔥'}
            </span>
          </motion.div>
          <div className="h-8 w-[1px] bg-white/10" />
          <div className="flex flex-col items-center">
            <span className="text-[8px] tracking-[4px] uppercase opacity-40">Skill level</span>
            <span className="text-xl font-bold text-emerald-400">Lv.{currentLevel}</span>
          </div>
        </div>
      </header>

      {/* Mobile-Optimized Status Info */}
      <section className="absolute right-6 sm:right-20 bottom-24 sm:bottom-20 text-right z-10 pointer-events-none">
        <div className="mb-4 sm:mb-6">
          <div className="text-[8px] sm:text-[10px] uppercase tracking-[2px] sm:tracking-[3px] text-[#0ff] mb-1 font-bold">NEURAL LOAD</div>
          <div className="text-xl sm:text-3xl font-light font-mono">
            {state === 'IDLE' ? 'SCANNING...' : state === 'STABILIZING' ? 'LOCKING...' : 'LOCKED'}
          </div>
        </div>
        
        {bestGuessLabel && (state === 'IDLE' || state === 'STABILIZING') && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-4"
          >
             <div className="text-[8px] sm:text-[10px] uppercase tracking-[2px] text-white/40 mb-1 font-bold">BEST GUESS</div>
             <div className="text-lg sm:text-2xl font-bold text-cyan-400 italic">"{bestGuessLabel}"</div>
          </motion.div>
        )}

        {state === 'STABILIZING' && (
          <div className="space-y-1">
            <div className="flex justify-between text-[8px] font-mono text-cyan-400">
              <span>SYNCING...</span>
              <span>{lockProgress}%</span>
            </div>
            <div className="w-32 sm:w-48 h-1 bg-white/10 relative overflow-hidden ml-auto">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${lockProgress}%` }}
                className="absolute inset-0 bg-cyan-400"
              />
            </div>
          </div>
        )}
      </section>

      <main className="absolute inset-0 flex items-center justify-center pointer-events-none p-4">
        <AnimatePresence mode="wait">
          {state === 'IDLE' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6"
            >
              <CircleDot className="w-10 h-10 sm:w-12 sm:h-12 text-white/20 animate-pulse" />
              <div className="text-[9px] sm:text-[11px] tracking-[2px] sm:tracking-[4px] uppercase border border-white/20 px-6 sm:px-8 py-2 rounded-full bg-white/5 text-center">
                Scan for compatible objects...
              </div>
            </motion.div>
          )}

          {(state === 'GUESSING' || state === 'RESULT') && detectedObject && (
            <motion.div
              key="game-card"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.1, opacity: 0 }}
              className="relative pointer-events-auto w-full max-w-[340px] sm:max-w-[420px]"
            >
              <div 
                className={`w-full min-h-[480px] max-h-[80vh] border-2 sm:border-4 border-[#444] shadow-[0_0_50px_rgba(0,0,0,1)] 
                           flex flex-col justify-center items-center relative overflow-hidden transition-all duration-700 rounded-3xl p-6
                           ${state === 'RESULT' && isCorrect ? 'bg-cyan-900/60 ring-4 ring-cyan-500' : state === 'RESULT' && !isCorrect ? 'bg-red-900/60 ring-4 ring-red-500' : 'bg-zinc-900/95 grayscale'}`}
              >
                {/* 20s Header Timer */}
                <div className="absolute top-0 left-0 right-0 h-16 bg-black/40 flex items-center justify-between px-6 border-b border-white/10">
                  <div className="flex flex-col">
                    <span className="text-[8px] tracking-widest opacity-40 uppercase">Challenge Time</span>
                    <span className="text-xl font-mono font-bold text-cyan-400">00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}</span>
                  </div>
                  <div className="w-8 h-8 rounded-full border-2 border-cyan-500 flex items-center justify-center">
                    <div className="w-4 h-4 bg-cyan-500 rounded-full animate-pulse" />
                  </div>
                </div>
                
                <div className="text-[60px] sm:text-[100px] font-black leading-none tracking-[-6px] mb-2 z-10 opacity-10">
                  {state === 'RESULT' && isCorrect ? detectedObject.article : '???'}
                </div>
                
                <div className="text-[28px] sm:text-[40px] font-black uppercase tracking-[4px] sm:tracking-[6px] z-10 text-center px-4 leading-tight">
                  {detectedObject.name}
                </div>

                <AnimatePresence>
                  {state === 'RESULT' && (
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="absolute inset-0 z-30 flex flex-col bg-black/95 p-6 pb-8 backdrop-blur-xl overflow-y-auto scrollbar-none"
                    >
                      <div className="flex-1 flex flex-col items-center justify-center w-full min-h-max pt-10 px-2">
                        <div className={`text-4xl font-black mb-3 drop-shadow-[0_2px_10px_rgba(255,255,255,0.3)] ${isCorrect ? 'text-cyan-400' : 'text-orange-400'}`}>
                          {isCorrect ? 'برنس!' : 'فرصة تانية'}
                        </div>
                        
                        <div className="text-xl font-bold font-sans text-white text-center leading-relaxed mb-8">
                          "{slangMessage}"
                        </div>

                        {!isCorrect && (
                          <div className="w-full flex flex-col items-center gap-6 mb-8">
                            <button 
                              onClick={() => setShowHint(!showHint)}
                              className={`p-4 rounded-full transition-all duration-300 ${showHint ? 'bg-orange-400 text-black scale-110 shadow-[0_0_20px_rgba(251,146,60,0.5)]' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                            >
                              <Lightbulb className="w-8 h-8" />
                            </button>
                            
                            <AnimatePresence>
                              {showHint && detectedObject.explanation && (
                                <motion.div 
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="text-sm text-orange-200 text-center bg-orange-950/40 p-5 rounded-2xl border border-orange-400/30 w-full max-w-[320px] leading-relaxed italic"
                                >
                                  {detectedObject.explanation}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-col w-full gap-3 mt-6">
                        {!isCorrect && (
                          <button 
                            onClick={tryAgain}
                            className="w-full py-4 flex items-center justify-center gap-2 bg-white/10 text-white font-bold uppercase tracking-[2px] hover:bg-white/20 transition-all rounded-2xl"
                          >
                            <RotateCcw className="w-5 h-5" />
                            Try Again
                          </button>
                        )}
                        <button 
                          onClick={reset}
                          className="w-full py-4 bg-cyan-500 text-black font-black uppercase tracking-[4px] hover:scale-[1.02] active:scale-[0.98] transition-all rounded-2xl shadow-[0_4px_15px_rgba(0,255,255,0.3)]"
                        >
                          Scan New
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Global Bottom UI - Always Visible Layer */}
      <div className="absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 z-40 w-full max-w-sm px-6 pointer-events-none">
        <AnimatePresence>
           {(state === 'GUESSING' || (state === 'RESULT' && detectedObject)) && (
             <motion.div 
               initial={{ y: 100, opacity: 0 }}
               animate={{ y: 0, opacity: 1 }}
               exit={{ y: 100, opacity: 0 }}
               className="grid grid-cols-3 gap-3 pointer-events-auto"
             >
                {(['DER', 'DIE', 'DAS'] as Article[]).map((art) => {
                  const isUserChoice = userGuess === art;
                  const isCorrectAnswer = detectedObject?.article === art;
                  
                  let btnClass = "bg-white/10 border border-white/20 text-white/60";
                  if (state === 'RESULT') {
                    if (isCorrect) {
                      if (isCorrectAnswer) btnClass = "bg-cyan-500 text-black border-cyan-400 shadow-[0_0_20px_rgba(0,255,255,0.5)] z-10 scale-110";
                      else btnClass = "bg-black/40 border-white/5 opacity-10 blur-[1px]";
                    } else {
                      if (isUserChoice) btnClass = "bg-red-500 text-white border-red-400 opacity-100 scale-105";
                      else btnClass = "bg-black/40 border-white/5 opacity-30";
                    }
                  }

                  return (
                    <button
                      key={art}
                      disabled={state === 'RESULT'}
                      onClick={() => handleGuess(art)}
                      className={`${btnClass} py-4 sm:py-6 text-2xl font-black tracking-[2px] rounded-2xl transition-all duration-300 active:scale-90`}
                    >
                      {art}
                    </button>
                  );
                })}
             </motion.div>
           )}
           
           {state === 'IDLE' && (
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               className="flex justify-center"
             >
               <div className="px-6 py-3 border border-white/10 rounded-full bg-white/5 text-[10px] tracking-[4px] uppercase text-white/40 font-bold backdrop-blur-sm">
                  Neural Scan Active
               </div>
             </motion.div>
           )}
        </AnimatePresence>
      </div>

      {/* Model Loading Status */}
      {!model && !error && (
        <div className="absolute top-24 right-6 text-right font-mono text-[8px] text-cyan-400 animate-pulse">
          LOADING NEURAL CORE...
        </div>
      )}
    </div>
  );
}
