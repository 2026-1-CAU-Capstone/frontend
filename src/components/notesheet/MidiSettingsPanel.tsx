/* ─────────────────────────────────────────────────────────────────────────
 * MidiSettingsBody — 에디터 툴바 "MIDI" 탭의 본문.
 *
 * 입력/출력 장치 선택, 실시간 입력 모니터(수신 표시등 + 마지막 음/벨로시티/
 * 채널), 그리고 벨로시티 임계값·채널 필터·옥타브 이동·오디션 재생·벨로시티→
 * 소리세기·MIDI thru 에코 등 고급 설정을 한 곳에서 조절한다.
 *
 * 예전엔 별도 모달이었는데, 툴바 탭으로 들어오며 폭이 넓어져 두 칸으로 나눴다
 * (왼쪽=장치·모니터, 오른쪽=입력 처리). 모달 껍데기(오버레이/닫기)는 없앴다.
 *
 * 상태·로직은 useMidiInput 훅이 소유하고, 이 컴포넌트는 그 값을 표시/변경만 한다.
 * ──────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { midiToName, type UseMidi } from '../../hooks/useMidiInput';

export function MidiSettingsBody({ midi }: { midi: UseMidi }) {
  const { supported, error, enabled, requestAccess, inputs, outputs, settings, setSettings, last, pulse } = midi;

  // 최근 수신 여부(모니터 "라이브" 표시). pulse 가 바뀌면 잠깐 켰다 끈다.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!pulse) return;
    setLive(true);
    const t = setTimeout(() => setLive(false), 180);
    return () => clearTimeout(t);
  }, [pulse]);

  if (!supported) {
    return (
      <Warn>
        이 브라우저는 <b>Web MIDI</b>를 지원하지 않습니다.<br />
        Chrome 또는 Edge에서 외부 MIDI 기기를 연결하세요.
      </Warn>
    );
  }

  return (
    <>
      {error && (
        <Warn>
          {error}
          <RetryBtn type="button" onClick={requestAccess}>다시 시도</RetryBtn>
        </Warn>
      )}

      <Cols>
        {/* ── 왼쪽: 연결된 기기 + 실시간 모니터 ── */}
        <Col>
          <SectionLabel>기기</SectionLabel>

          <Monitor>
            <Dot key={pulse} $live={live} $on={last?.on ?? false} />
            <MonText>
              {!enabled ? '연결 대기…'
                : last ? `${last.on ? '입력' : '해제'} · ${midiToName(last.midi)} · vel ${last.velocity} · ch ${last.channel + 1}`
                : '입력 대기 중 — 건반을 눌러보세요'}
            </MonText>
          </Monitor>

          <Row>
            <Label>입력 장치</Label>
            <Select
              value={settings.inputId ?? ''}
              onChange={(e) => setSettings({ inputId: e.target.value || null })}
            >
              <option value="">— 없음 —</option>
              {inputs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Row>
          {inputs.length === 0 && enabled && (
            <Hint>감지된 입력 장치가 없습니다. USB MIDI 키보드를 연결하면 자동 선택됩니다.</Hint>
          )}

          <Row>
            <Label>출력 장치</Label>
            <Select
              value={settings.outputId ?? ''}
              onChange={(e) => setSettings({ outputId: e.target.value || null })}
            >
              <option value="">— 없음 —</option>
              {outputs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Row>
          <CheckRow>
            <input id="midi-echo" type="checkbox" checked={settings.echoToOutput}
              onChange={(e) => setSettings({ echoToOutput: e.target.checked })} />
            <label htmlFor="midi-echo">출력으로 그대로 전달 (MIDI thru — 외부 음원 연주)</label>
          </CheckRow>
        </Col>

        {/* ── 오른쪽: 입력을 어떻게 받아들일지 ── */}
        <Col>
          <SectionLabel>입력 처리</SectionLabel>

          <SliderRow>
            <Label>벨로시티 임계값</Label>
            <input type="range" min={0} max={127} step={1} value={settings.velocityThreshold}
              onChange={(e) => setSettings({ velocityThreshold: parseInt(e.target.value, 10) })} />
            <Num>{settings.velocityThreshold}</Num>
          </SliderRow>
          <Hint>이 세기보다 약하게 친 음은 무시합니다(가벼운 오터치 방지).</Hint>

          <Row>
            <Label>채널</Label>
            <Select
              value={String(settings.channel)}
              onChange={(e) => setSettings({ channel: parseInt(e.target.value, 10) })}
            >
              <option value="-1">전체</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={String(i)}>{i + 1}</option>
              ))}
            </Select>
          </Row>

          <SliderRow>
            <Label>옥타브 이동</Label>
            <input type="range" min={-3} max={3} step={1} value={settings.octaveShift}
              onChange={(e) => setSettings({ octaveShift: parseInt(e.target.value, 10) })} />
            <Num>{settings.octaveShift > 0 ? `+${settings.octaveShift}` : settings.octaveShift}</Num>
          </SliderRow>

          <CheckRow>
            <input id="midi-audition" type="checkbox" checked={settings.auditionOnInput}
              onChange={(e) => setSettings({ auditionOnInput: e.target.checked })} />
            <label htmlFor="midi-audition">입력 시 소리 재생</label>
          </CheckRow>
          <CheckRow>
            <input id="midi-veltoaud" type="checkbox" checked={settings.velocityToAudition}
              disabled={!settings.auditionOnInput}
              onChange={(e) => setSettings({ velocityToAudition: e.target.checked })} />
            <label htmlFor="midi-veltoaud">세게 칠수록 크게 (벨로시티 → 소리 세기)</label>
          </CheckRow>
        </Col>
      </Cols>

      <Foot>연결된 건반을 누르면 현재 선택된 음표 길이·임시표·삽입/양손·화음 설정 그대로 악보에 입력됩니다.</Foot>
    </>
  );
}

/* ─── styles ─────────────────────────────────────────────────────────────── */
const Cols = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 28px;
  font-size: 13px;
  color: #222;

  @media (max-width: 900px) { grid-template-columns: minmax(0, 1fr); }
`;
const Col = styled.div`min-width: 0;`;
const Warn = styled.div`
  background: #fff5f5; border: 1px solid #f2c2c2; color: #b23b3b;
  border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; line-height: 1.5;
  font-size: 13px;
`;
const RetryBtn = styled.button`
  margin-left: 8px; border: 1px solid #d88; background: #fff; color: #b23b3b;
  border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px;
`;
const blink = keyframes`0% { transform: scale(1.6); } 100% { transform: scale(1); }`;
const Monitor = styled.div`
  display: flex; align-items: center; gap: 9px;
  background: #f6f8fa; border: 1px solid #e3e8ee; border-radius: 8px;
  padding: 9px 11px; margin-bottom: 10px;
`;
const Dot = styled.span<{ $live: boolean; $on: boolean }>`
  width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;
  background: ${(p) => (p.$live ? (p.$on ? '#2e9c56' : '#c99a2e') : '#c7d0da')};
  animation: ${(p) => (p.$live ? blink : 'none')} 0.18s ease-out;
`;
const MonText = styled.span`font-variant-numeric: tabular-nums; color: #40515f;`;
const Row = styled.div`display: flex; align-items: center; gap: 10px; margin: 7px 0;`;
const SliderRow = styled(Row)`input[type='range'] { flex: 1; accent-color: #ef6c00; }`;
const Label = styled.span`width: 92px; flex-shrink: 0; color: #556;`;
const Num = styled.span`width: 34px; text-align: right; font-variant-numeric: tabular-nums;`;
const Select = styled.select`
  flex: 1; min-width: 0; padding: 5px 7px; border: 1px solid #ccc; border-radius: 6px;
  font-size: 12.5px; background: #fff; color: #222;
`;
const CheckRow = styled.div`
  display: flex; align-items: center; gap: 8px; margin: 7px 0;
  label { color: #445; }
  input:disabled + label { color: #aab; }
`;
const SectionLabel = styled.div`
  margin: 0 0 7px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  color: #8a97a4; border-bottom: 1px solid #eceff3; padding-bottom: 3px;
`;
const Hint = styled.div`font-size: 11px; color: #8a97a4; margin: 2px 0 6px; line-height: 1.45;`;
const Foot = styled.div`
  margin-top: 12px; padding-top: 9px; border-top: 1px solid #eceff3;
  font-size: 11.5px; color: #7a8894; line-height: 1.5;
`;
