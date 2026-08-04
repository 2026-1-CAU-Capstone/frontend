/* ─────────────────────────────────────────────────────────────────────────
 * MidiSettingsBody — 에디터 툴바 "MIDI" 탭의 본문.
 *
 * 툴바 탭은 어느 탭을 골라도 높이가 같아야 한다(EditorPage 의 TOOLBAR_H).
 * 그래서 예전 모달의 세로 나열을 **3개 묶음 × 3줄**로 눕혀, 음표 탭과 같은
 * 한 줄 높이 안에 들어가게 했다. 묶음 상자는 툴바 Section 과 같은 규격
 * (2px 테두리 · 라운드 12px · 흰 배경)이라 다른 탭과 결이 맞는다.
 *
 * 줄 수를 줄이려고 설명 문구는 각 컨트롤의 title 로 옮겼다.
 *
 * 상태·로직은 useMidiInput 훅이 소유하고, 이 컴포넌트는 그 값을 표시/변경만 한다.
 * ──────────────────────────────────────────────────────────────────────── */
import styled, { keyframes } from 'styled-components';
import { midiToName, type UseMidi } from '../../hooks/useMidiInput';

export function MidiSettingsBody({ midi }: { midi: UseMidi }) {
  const { supported, error, enabled, requestAccess, inputs, outputs, settings, setSettings, last, pulse } = midi;

  if (!supported) {
    return (
      <Box style={{ flex: 1 }}>
        <Warn>
          이 브라우저는 <b>Web MIDI</b>를 지원하지 않습니다 — Chrome 또는 Edge에서 외부 MIDI 기기를 연결하세요.
        </Warn>
      </Box>
    );
  }

  if (error) {
    return (
      <Box style={{ flex: 1 }}>
        <Warn>
          {error}
          <RetryBtn type="button" onClick={requestAccess}>다시 시도</RetryBtn>
        </Warn>
      </Box>
    );
  }

  return (
    <>
      {/* ── 1) 연결된 기기 ── */}
      <Box>
        <BoxTitle>기기</BoxTitle>
        <Monitor>
          <Dot key={pulse} $pulse={pulse} $on={last?.on ?? false} />
          <MonText>
            {!enabled ? '연결 대기…'
              : last ? `${midiToName(last.midi)} · vel ${last.velocity} · ch ${last.channel + 1}`
              : '건반을 눌러보세요'}
          </MonText>
        </Monitor>
        <Row>
          <Label>입력</Label>
          <Select
            title={inputs.length === 0 ? 'USB MIDI 키보드를 연결하면 자동으로 선택됩니다' : '음표를 입력받을 기기'}
            value={settings.inputId ?? ''}
            onChange={(e) => setSettings({ inputId: e.target.value || null })}
          >
            <option value="">— 없음 —</option>
            {inputs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Row>
        <Row>
          <Label>출력</Label>
          <Select
            title="MIDI thru 로 신호를 그대로 넘길 기기"
            value={settings.outputId ?? ''}
            onChange={(e) => setSettings({ outputId: e.target.value || null })}
          >
            <option value="">— 없음 —</option>
            {outputs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Row>
      </Box>

      {/* ── 2) 입력을 어떻게 받아들일지 ── */}
      <Box>
        <BoxTitle>입력 처리</BoxTitle>
        <Row title="이 세기보다 약하게 친 음은 무시합니다(가벼운 오터치 방지).">
          <Label>임계값</Label>
          <Range type="range" min={0} max={127} step={1} value={settings.velocityThreshold}
            onChange={(e) => setSettings({ velocityThreshold: parseInt(e.target.value, 10) })} />
          <Num>{settings.velocityThreshold}</Num>
        </Row>
        <Row title="특정 MIDI 채널만 받아들입니다.">
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
        <Row title="건반에서 받은 음을 옥타브 단위로 옮겨 입력합니다.">
          <Label>옥타브</Label>
          <Range type="range" min={-3} max={3} step={1} value={settings.octaveShift}
            onChange={(e) => setSettings({ octaveShift: parseInt(e.target.value, 10) })} />
          <Num>{settings.octaveShift > 0 ? `+${settings.octaveShift}` : settings.octaveShift}</Num>
        </Row>
      </Box>

      {/* ── 3) 켜고 끄는 것들 ── */}
      <Box>
        <BoxTitle>옵션</BoxTitle>
        <CheckRow title="받은 신호를 출력 기기로 그대로 넘겨 외부 음원을 연주합니다.">
          <input id="midi-echo" type="checkbox" checked={settings.echoToOutput}
            onChange={(e) => setSettings({ echoToOutput: e.target.checked })} />
          <label htmlFor="midi-echo">MIDI thru</label>
        </CheckRow>
        <CheckRow title="건반을 누를 때 내장 음원으로 소리를 들려줍니다.">
          <input id="midi-audition" type="checkbox" checked={settings.auditionOnInput}
            onChange={(e) => setSettings({ auditionOnInput: e.target.checked })} />
          <label htmlFor="midi-audition">입력 시 소리 재생</label>
        </CheckRow>
        <CheckRow title="벨로시티를 오디션 소리 세기에 반영합니다.">
          <input id="midi-veltoaud" type="checkbox" checked={settings.velocityToAudition}
            disabled={!settings.auditionOnInput}
            onChange={(e) => setSettings({ velocityToAudition: e.target.checked })} />
          <label htmlFor="midi-veltoaud">세게 칠수록 크게</label>
        </CheckRow>
        <CheckRow title="화음을 동시에 누르면 코드 이름(예: CM7)을 알아내 현재 마디의 코드칸에 넣습니다. 이 모드에선 음표는 입력되지 않습니다.">
          <input id="midi-chorddetect" type="checkbox" checked={settings.chordDetect}
            onChange={(e) => setSettings({ chordDetect: e.target.checked })} />
          <label htmlFor="midi-chorddetect">화음 → 코드 심볼 인식</label>
        </CheckRow>
      </Box>
    </>
  );
}

/* ─── styles ─────────────────────────────────────────────────────────────
 * 상자 규격은 EditorPage 의 툴바 Section 과 동일하게 맞춘다. */
const Box = styled.div`
  position: relative;   /* BoxTitle(윗 테두리 겹침 라벨) 기준 */
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  /* 라벨이 테두리에 걸치므로 위 여백을 살짝 더 준다 — EditorPage 섹션과 동일 결. */
  padding: 8px 9px 5px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
  font-size: 12.5px;
  color: ${({ theme }) => theme.colors.textPrimary};
  min-width: 0;
`;
/* EditorPage 의 BoxLegend 와 같은 규격 — 섹션 제목이 윗 테두리에 겹친다. */
const BoxTitle = styled.span`
  position: absolute;
  top: -8px;
  left: 12px;
  z-index: 1;
  padding: 0 6px;
  background: ${({ theme }) => theme.colors.barBelow};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.76rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
  line-height: 1;
`;
const Warn = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #b23b3b;
  line-height: 1.5;
`;
const RetryBtn = styled.button`
  flex-shrink: 0;
  border: 1px solid #d88; background: ${({ theme }) => theme.colors.surface}; color: #b23b3b;
  border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px;
`;
/* 수신 점멸을 상태가 아니라 애니메이션으로 처리한다 — 음을 칠 때마다
 * setState 로 리렌더하던 것을 없앴다(연주 중엔 초당 수십 번 불린다). */
const IDLE = '#c7d0da';
const flashOn = keyframes`
  0% { background: #2e9c56; transform: scale(1.6); }
  100% { background: ${IDLE}; transform: scale(1); }
`;
const flashOff = keyframes`
  0% { background: #c99a2e; transform: scale(1.6); }
  100% { background: ${IDLE}; transform: scale(1); }
`;
const Monitor = styled.div`
  display: flex; align-items: center; gap: 7px;
  background: ${({ theme }) => theme.colors.surface}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 7px;
  padding: 4px 8px;
  min-width: 0;
`;
const Dot = styled.span<{ $pulse: number; $on: boolean }>`
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
  background: ${IDLE};
  /* pulse 가 0(아직 수신 전)이면 애니메이션을 걸지 않는다 — 처음 뜰 때 헛점멸 방지. */
  animation: ${({ $pulse, $on }) => ($pulse ? ($on ? flashOn : flashOff) : 'none')} 0.4s ease-out;
`;
const MonText = styled.span`
  font-variant-numeric: tabular-nums; color: #40515f;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Row = styled.div`display: flex; align-items: center; gap: 7px; min-width: 0;`;
const Label = styled.span`width: 46px; flex-shrink: 0; color: ${({ theme }) => theme.colors.textSecondary};`;
const Range = styled.input`flex: 1; min-width: 60px; accent-color: #ef6c00;`;
const Num = styled.span`width: 26px; text-align: right; font-variant-numeric: tabular-nums;`;
const Select = styled.select`
  flex: 1; min-width: 0; padding: 3px 5px; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 6px;
  font-size: 12px; background: ${({ theme }) => theme.colors.surface}; color: ${({ theme }) => theme.colors.textPrimary};
`;
const CheckRow = styled.div`
  display: flex; align-items: center; gap: 7px;
  label { color: ${({ theme }) => theme.colors.textPrimary}; }
  input:disabled + label { color: ${({ theme }) => theme.colors.textSecondary}; }
`;
