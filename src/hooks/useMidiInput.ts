/* ─────────────────────────────────────────────────────────────────────────
 * useMidiInput — Web MIDI 외부 기기(피아노 등) 입력 훅.
 *
 * 선택한 MIDI 입력 포트의 note-on 을 파싱해 `onNoteOn` 콜백으로 넘긴다.
 * 에디터는 이 콜백에서 기존 `handleNotePress` 를 호출하므로 길이·임시표·
 * 삽입·양손·화음 로직이 전부 그대로 재사용된다.
 *
 * 설정(입력/출력 포트, 벨로시티 임계값, 채널 필터, 옥타브 이동, 오디션 재생,
 * 벨로시티→소리세기, MIDI thru 에코)은 localStorage 에 저장된다.
 *
 * Web MIDI 는 Chrome/Edge 지원(사파리 미지원). 미지원 시 supported=false.
 * lib.dom 에 Web MIDI 타입이 없어 필요한 최소 표면만 로컬 선언한다.
 * ──────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useRef, useState } from 'react';

/* ── 최소 Web MIDI 타입 표면 ─────────────────────────────────────────────── */
interface MIDIMessageEventLike { data: Uint8Array | null }
interface MIDIPortLike { id: string; name?: string | null; state?: string }
interface MIDIInputLike extends MIDIPortLike { onmidimessage: ((e: MIDIMessageEventLike) => void) | null }
interface MIDIOutputLike extends MIDIPortLike { send(data: number[] | Uint8Array): void }
interface MIDIAccessLike {
  inputs: Map<string, MIDIInputLike>;
  outputs: Map<string, MIDIOutputLike>;
  onstatechange: ((e: unknown) => void) | null;
}
type RequestMIDIAccess = (opts?: { sysex?: boolean }) => Promise<MIDIAccessLike>;

/* ── 설정 ────────────────────────────────────────────────────────────────── */
export interface MidiSettings {
  /** 선택된 입력 포트 id. null = 미선택. */
  inputId: string | null;
  /** 선택된 출력 포트 id (MIDI thru 에코용). */
  outputId: string | null;
  /** true 면 들어온 메시지를 출력 포트로 그대로 흘려보낸다(외부 음원 연주). */
  echoToOutput: boolean;
  /** 이 값보다 약한 note-on 은 무시(가벼운 오터치 방지). 0..127. */
  velocityThreshold: number;
  /** 채널 필터. -1 = 전체, 0..15 = 특정 채널만. */
  channel: number;
  /** 옥타브 이동(±3). 옥타브가 밀린 키보드/이조 악기 대응. */
  octaveShift: number;
  /** 입력 시 내부 사운드폰트로 오디션 재생할지. */
  auditionOnInput: boolean;
  /** 벨로시티(세게 칠수록)를 오디션 소리 크기에 반영할지. */
  velocityToAudition: boolean;
}

export interface MidiActivity { midi: number; velocity: number; channel: number; on: boolean; t: number }
export interface MidiNoteEvent { midi: number; velocity: number; channel: number }

const LS_KEY = 'jazzify.editor.midi.v1';
const DEFAULTS: MidiSettings = {
  inputId: null, outputId: null, echoToOutput: false,
  velocityThreshold: 1, channel: -1, octaveShift: 0,
  auditionOnInput: true, velocityToAudition: true,
};

function loadSettings(): MidiSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return { ...DEFAULTS, ...p };
    }
  } catch { /* noop */ }
  return { ...DEFAULTS };
}

export interface UseMidi {
  supported: boolean;
  error: string | null;
  enabled: boolean;
  requestAccess: () => void;
  inputs: { id: string; name: string }[];
  outputs: { id: string; name: string }[];
  settings: MidiSettings;
  setSettings: (patch: Partial<MidiSettings>) => void;
  /** 마지막으로 수신한 메시지(모니터 표시용). */
  last: MidiActivity | null;
  /** 메시지마다 증가 — 활동 표시등 깜빡임 트리거. */
  pulse: number;
}

export function useMidiInput(onNoteOn: (e: MidiNoteEvent) => void): UseMidi {
  const supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<MIDIAccessLike | null>(null);
  const [inputs, setInputs] = useState<{ id: string; name: string }[]>([]);
  const [outputs, setOutputs] = useState<{ id: string; name: string }[]>([]);
  const [settings, setSettingsState] = useState<MidiSettings>(loadSettings);
  const [last, setLast] = useState<MidiActivity | null>(null);
  const [pulse, setPulse] = useState(0);

  // 최신값 ref — MIDI 콜백/구독이 stale 클로저를 안 잡게. (렌더 중 write 금지
  // 규칙 때문에 effect 에서 갱신 — MIDI 메시지는 훨씬 뒤 비동기라 안전.)
  const onNoteOnRef = useRef(onNoteOn);
  const settingsRef = useRef(settings);
  useEffect(() => { onNoteOnRef.current = onNoteOn; }, [onNoteOn]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const setSettings = useCallback((patch: Partial<MidiSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const refreshPorts = useCallback((a: MIDIAccessLike) => {
    const ins = [...a.inputs.values()].map((p) => ({ id: p.id, name: p.name || 'MIDI Input' }));
    setInputs(ins);
    setOutputs([...a.outputs.values()].map((p) => ({ id: p.id, name: p.name || 'MIDI Output' })));
    // 미선택 상태에서 입력 포트가 나타나면 첫 포트 자동 선택(편의). effect 가 아니라
    // 포트 갱신 콜백(비동기)에서 처리 — set-state-in-effect 회피.
    if (!settingsRef.current.inputId && ins.length > 0) setSettings({ inputId: ins[0].id });
  }, [setSettings]);

  const requestAccess = useCallback(() => {
    if (!supported) {
      setError('이 브라우저는 Web MIDI를 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.');
      return;
    }
    const req = (navigator as unknown as { requestMIDIAccess: RequestMIDIAccess }).requestMIDIAccess;
    req({ sysex: false })
      .then((a) => {
        setAccess(a);
        setError(null);
        refreshPorts(a);
        a.onstatechange = () => refreshPorts(a);
      })
      .catch((e) => setError('MIDI 접근이 거부되었습니다: ' + (e instanceof Error ? e.message : String(e))));
  }, [supported, refreshPorts]);

  // 접근 요청은 사용자 제스처(MIDI 버튼 클릭)에서 트리거한다 — 페이지 로드 시
  // 권한 프롬프트를 띄우지 않고, 사용자가 MIDI를 켤 때만 요청.

  // access 최신값 ref (에코 출력 조회용).
  const accessRef = useRef<MIDIAccessLike | null>(null);
  useEffect(() => { accessRef.current = access; }, [access]);

  // MIDI 메시지 핸들러 — 안정(stable) 콜백. setState 는 이 이벤트 콜백에서만
  // 일어나므로 effect 본문에 setState 를 두지 않는다.
  const handleMessage = useCallback((e: MIDIMessageEventLike) => {
    const d = e.data;
    if (!d || d.length < 3) return;
    const status = d[0];
    const type = status & 0xf0;
    const ch = status & 0x0f;
    const s = settingsRef.current;
    if (s.channel >= 0 && ch !== s.channel) return;
    const isOn = type === 0x90 && d[2] > 0;
    const isOff = type === 0x80 || (type === 0x90 && d[2] === 0);
    if (!isOn && !isOff) return;
    const note = d[1] + s.octaveShift * 12;
    const vel = d[2];
    setPulse((p) => (p + 1) % 1e9);
    setLast({ midi: note, velocity: vel, channel: ch, on: isOn, t: Date.now() });
    // MIDI thru: 원본 메시지를 출력 포트로 그대로 전달.
    if (s.echoToOutput && s.outputId) {
      const out = accessRef.current?.outputs.get(s.outputId);
      if (out) { try { out.send([...d]); } catch { /* noop */ } }
    }
    if (isOn) {
      if (vel < s.velocityThreshold) return;
      onNoteOnRef.current({ midi: note, velocity: vel, channel: ch });
    }
  }, []);

  // 선택된 입력 포트에만 핸들러를 붙인다(나머지는 해제).
  useEffect(() => {
    const a = access;
    if (!a) return;
    const inId = settings.inputId;
    for (const inp of a.inputs.values()) inp.onmidimessage = inp.id === inId ? handleMessage : null;
    return () => { for (const inp of a.inputs.values()) { if (inp.onmidimessage === handleMessage) inp.onmidimessage = null; } };
  }, [access, settings.inputId, handleMessage]);

  return { supported, error, enabled: !!access, requestAccess, inputs, outputs, settings, setSettings, last, pulse };
}

/** MIDI 음번호 → 음이름(모니터 표시용). 예: 60 → "C4". */
export function midiToName(midi: number): string {
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NAMES[pc]}${oct}`;
}
