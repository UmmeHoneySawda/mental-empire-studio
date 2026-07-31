import { memo, useCallback, useMemo, useState } from 'react'
import type { JsonObject, VideoTemplate } from '@shared/video-engine'
import { useVideoStudio } from '../store/useVideoStudio'
import {
  StudioSection,
  Row,
  Labeled,
  TextField,
  NumberField,
  EmptyHint,
  PromptExchange,
  TemplateCard,
  ParamFields,
  defaultTemplateProps,
  useTimecode
} from '../ui/kit'
import { Btn, SliderRow } from '../../../components/ui/kit'

/* Words per cue is a caption-template parameter, but it also decides how the cue
   list below is grouped — so it gets its own control here and ParamFields never
   renders a second one for the same key. */
const WORDS_PER_CUE = 'maxWordsPerCue'
const DEFAULT_WORDS_PER_CUE = 6

/** The click ladder skips level 1: an AI pass uses that for a soft emphasis, while
 *  clicking is how the user marks a word they want unmistakably loud. */
function nextImportance(current: number): 0 | 2 | 3 {
  if (current === 2) return 3
  if (current === 3) return 0
  return 2
}

/** Memoised because the word list is the largest thing in the studio — thousands of
 *  nodes — and it re-renders whenever any part of the project changes. Only the words
 *  whose own emphasis actually moved do any work. */
const CaptionWord = memo(function CaptionWord({
  wordId,
  text,
  importance,
  title,
  onCycle
}: {
  wordId: string
  text: string
  importance: number
  title: string
  onCycle: (wordId: string, importance: number) => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="vs-word ed-focus"
      data-importance={String(importance)}
      title={title}
      onClick={() => onCycle(wordId, importance)}
    >
      {text}
    </button>
  )
})

function numberProp(props: JsonObject, key: string, fallback: number): number {
  const value = props[key]
  return typeof value === 'number' ? value : fallback
}

/** Enough of the hash to recognise, with the full value always one hover away. */
function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash
}

export function CaptionsPanel(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const templates = useVideoStudio((state) => state.templates)
  const cues = useVideoStudio((state) => state.cues)
  const downloadId = useVideoStudio((state) => state.downloadId)
  const busy = useVideoStudio((state) => state.busy)
  const transcribeMessage = useVideoStudio((state) => state.transcribeMessage)
  const captionsFromTranscript = useVideoStudio((state) => state.captionsFromTranscript)
  const captionsFromSrt = useVideoStudio((state) => state.captionsFromSrt)
  const setCaptionTemplate = useVideoStudio((state) => state.setCaptionTemplate)
  const refreshCues = useVideoStudio((state) => state.refreshCues)
  const importantWordsPrompt = useVideoStudio((state) => state.importantWordsPrompt)
  const applyImportantWords = useVideoStudio((state) => state.applyImportantWords)
  const setWordImportance = useVideoStudio((state) => state.setWordImportance)

  const [srt, setSrt] = useState('')
  // null means "follow the style already on the project"; a value is the user's pick.
  const [draft, setDraft] = useState<{ id: string; props: JsonObject } | null>(null)
  const [purpose, setPurpose] = useState('')
  const [percent, setPercent] = useState(35)
  const [pending, setPending] = useState('')

  const styles = useMemo(() => templates.filter((template) => template.kind === 'caption'), [templates])
  const fps = project?.canvas.fps ?? 30
  const timecode = useTimecode(fps)

  // Stable identity, so memoised word buttons are not invalidated on every render.
  // Declared above the early return to keep the hook order fixed.
  const cycleWord = useCallback((wordId: string, importance: number): void => {
    void setWordImportance([wordId], nextImportance(importance))
  }, [setWordImportance])

  if (!project) {
    return (
      <StudioSection label="Captions">
        <EmptyHint
          title="No project open yet"
          body="Open a downloaded clip in this engine and its captions appear here."
        />
      </StudioSection>
    )
  }

  const captions = project.captions
  const hasWords = (captions?.words.length ?? 0) > 0
  const sceneTemplate = project.scenes.find((scene) => scene.kind === 'caption')?.template
  const selectedId = draft?.id ?? captions?.templateId ?? ''
  const selected = styles.find((template) => template.id === selectedId)
  // What the project already holds for the selected style, so the apply button can
  // tell an edited draft apart from the saved settings.
  const savedProps: JsonObject = selected
    ? sceneTemplate?.id === selected.id
      ? { ...defaultTemplateProps(selected), ...sceneTemplate.props }
      : defaultTemplateProps(selected)
    : {}
  const props = draft && draft.id === selectedId ? draft.props : savedProps
  const dirty = JSON.stringify(props) !== JSON.stringify(savedProps)
  const wordsPerCue = numberProp(props, WORDS_PER_CUE, DEFAULT_WORDS_PER_CUE)
  // ParamFields renders the rest of the contract; words per cue has its own field.
  const styleFields: VideoTemplate | undefined = selected
    ? { ...selected, parameters: selected.parameters.filter((parameter) => parameter.key !== WORDS_PER_CUE) }
    : undefined

  const start = async (key: string, task: () => Promise<void>): Promise<void> => {
    setPending(key)
    await task()
    setPending('')
  }

  const selectStyle = (template: VideoTemplate): void => {
    const seeded = sceneTemplate?.id === template.id
      ? { ...defaultTemplateProps(template), ...sceneTemplate.props }
      : defaultTemplateProps(template)
    setDraft({ id: template.id, props: seeded })
    void start('style', () => setCaptionTemplate(template.id, seeded))
  }

  const commitWordsPerCue = (value: number): void => {
    setDraft({ id: selectedId, props: { ...props, [WORDS_PER_CUE]: value } })
    void refreshCues(value)
  }

  const timings = (
    <StudioSection
      label="Word timings"
      hint="Captions here are timed word by word, so a highlight lands on the word being spoken rather than on the whole line."
    >
      <Row>
        <Btn
          variant="primary"
          disabled={Boolean(busy) || !downloadId}
          onClick={() => void start('transcript', () => captionsFromTranscript())}
        >
          {pending === 'transcript' && busy
            ? transcribeMessage || busy
            : hasWords ? '↻ Re-transcribe this clip' : 'Transcribe this clip'}
        </Btn>
        {pending === 'transcript' && transcribeMessage && (
          <span className="vs-hint" style={{ flex: 1 }}>{transcribeMessage}</span>
        )}
      </Row>
      <p className="vs-hint">
        {downloadId
          ? 'Runs Groq Whisper on the clip’s audio if it has not been transcribed yet, then imports the word timings. Captions are fetched automatically when you open a clip; this is for redoing them.'
          : 'This project is not bound to a downloaded clip, so there is no audio to transcribe. Paste an SRT instead.'}
      </p>

      <Labeled
        label="Paste an SRT"
        hint="For captions that came from somewhere else — an editor, a platform export, a subtitle file."
        wide
      >
        <textarea
          className="ed-input vs-textarea"
          value={srt}
          spellCheck={false}
          placeholder={'1\n00:00:01,000 --> 00:00:03,400\nEvery single frame counts'}
          onChange={(event) => setSrt(event.target.value)}
        />
      </Labeled>
      <Row>
        <Btn
          variant="soft"
          disabled={Boolean(busy) || !srt.trim()}
          onClick={() => void start('srt', () => captionsFromSrt(srt))}
        >
          {pending === 'srt' && busy ? busy : 'Import SRT'}
        </Btn>
      </Row>
      <p className="vs-hint">
        An SRT only times whole cues, so each cue is split across its words by length. Those word timings are an
        estimate — prefer the transcript whenever the clip has one.
      </p>

      {captions && (
        <div className="vs-kv">
          <span>Words</span>
          <span>{captions.words.length}</span>
          <span>Language</span>
          <span>{captions.language ?? 'Not recorded'}</span>
          <span>Transcript hash</span>
          <span className="vs-mono" title={captions.transcriptHash}>
            {shortHash(captions.transcriptHash)}
          </span>
        </div>
      )}
      {captions && (
        <p className="vs-hint">
          The hash is what ties an AI emphasis answer to these exact words — reimport the timings and every earlier
          answer stops applying.
        </p>
      )}
    </StudioSection>
  )

  if (!captions) {
    return (
      <>
        {timings}
        <EmptyHint
          title="Import word timings first"
          body="Caption styles, AI emphasis, and the word list all need timings to work on. Read the clip’s transcript or paste an SRT above."
        />
      </>
    )
  }

  const emphasised = captions.words.filter((word) => (word.importance ?? 0) > 0).map((word) => word.id)
  const wordById = new Map((cues?.words ?? captions.words).map((word) => [word.id, word]))

  return (
    <>
      {timings}

      <StudioSection
        label="Caption style"
        hint="The style decides how the words look and move. Applying one replaces the caption layer on the timeline."
      >
        {styles.length === 0 ? (
          <EmptyHint
            title="This renderer ships no caption styles"
            body={`The ${project.rendererId} renderer has no caption templates installed. Switch engines to reach a different set.`}
          />
        ) : (
          // TemplateCard takes no disabled prop, so the fieldset is what keeps a card
          // from firing a second mutation while one is still in flight.
          <fieldset
            disabled={Boolean(busy)}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0, opacity: busy ? 0.6 : 1 }}
          >
            <div className="vs-grid vs-grid--cards">
              {styles.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={template.id === selectedId}
                  fps={fps}
                  onSelect={() => selectStyle(template)}
                />
              ))}
            </div>
          </fieldset>
        )}

        <Row>
          <Labeled label="Words per line" hint="How many words share one cue before the next line starts.">
            <NumberField value={wordsPerCue} min={1} max={12} onCommit={commitWordsPerCue} suffix="words" />
          </Labeled>
        </Row>

        {selected && styleFields && (
          <>
            <ParamFields
              template={styleFields}
              value={props}
              assets={project.assets}
              onChange={(next) => setDraft({ id: selected.id, props: next })}
            />
            <Row>
              <Btn
                variant="primary"
                disabled={Boolean(busy) || !dirty}
                onClick={() => void start('style', () => setCaptionTemplate(selected.id, props))}
              >
                {pending === 'style' && busy ? busy : 'Apply caption style'}
              </Btn>
              {dirty && <span className="vs-hint">These settings are not on the timeline yet.</span>}
            </Row>
          </>
        )}
        {!selected && styles.length > 0 && (
          <p className="vs-hint">Pick a style to set its colors, font, and motion.</p>
        )}
      </StudioSection>

      <StudioSection
        label="Important words"
        hint="A second emphasis level on top of the spoken-word highlight, for the words the line is really about."
      >
        <Row>
          <Labeled
            label="What should stand out?"
            hint="Optional. The model reads this before it picks."
            wide
          >
            <TextField
              value={purpose}
              onChange={setPurpose}
              placeholder="the central claim, the numbers, and anything emotionally loaded"
              maxLength={500}
            />
          </Labeled>
        </Row>

        <SliderRow
          label="At most"
          value={percent}
          min={5}
          max={60}
          step={5}
          format={(value) => `${value}% of words`}
          onChange={setPercent}
          labelWidth={74}
        />

        <p className="vs-hint">
          The answer has to use the word ids from the prompt and repeat this transcript hash —{' '}
          <span className="vs-mono" title={captions.transcriptHash}>{shortHash(captions.transcriptHash)}</span>. A stale
          or invented id is rejected, so copy the prompt again after you change the timings.
        </p>

        <PromptExchange
          buildPrompt={() => importantWordsPrompt({ purpose: purpose.trim() || undefined, maximumSelectionRatio: percent / 100 })}
          onApply={(json) => applyImportantWords(json, percent / 100)}
          applyLabel="Apply emphasis"
          pasteLabel="Paste the JSON the model returned"
          busy={Boolean(busy)}
        />
      </StudioSection>

      {cues && cues.cues.length > 0 && (
        <StudioSection
          label="Words"
          hint="Click a word to cycle its emphasis: none, strong, loudest."
          headerRight={
            <Row>
              <span className="vs-mono">
                {emphasised.length}/{captions.words.length} marked
              </span>
              <Btn
                variant="danger"
                size="sm"
                disabled={Boolean(busy) || emphasised.length === 0}
                onClick={() => void start('clear', () => setWordImportance(emphasised, 0))}
              >
                {pending === 'clear' && busy ? busy : 'Clear all emphasis'}
              </Btn>
            </Row>
          }
        >
          {/* One fieldset instead of a `disabled` prop on every word: with thousands of
              buttons, flipping that prop per word rewrote the whole list on each
              mutation. */}
          <fieldset
            disabled={Boolean(busy)}
            className="vs-list vs-scroll"
            style={{ maxHeight: 320, border: 0, margin: 0, padding: 0, minWidth: 0 }}
          >
            {cues.cues.map((cue) => (
              <div key={cue.id} className="vs-cue">
                <span className="vs-cue-time">
                  {cue.startFrame}–{cue.endFrame}f · {timecode(cue.startFrame)}–{timecode(cue.endFrame)}
                </span>
                <div className="vs-words">
                  {cue.wordIds.map((wordId) => {
                    const word = wordById.get(wordId)
                    if (!word) return null
                    return (
                      <CaptionWord
                        key={wordId}
                        wordId={wordId}
                        text={word.text}
                        importance={word.importance ?? 0}
                        title={`${word.startFrame}–${word.endFrame}f · ${timecode(word.startFrame)}`}
                        onCycle={cycleWord}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </fieldset>
        </StudioSection>
      )}

      {cues && cues.cues.length === 0 && (
        <EmptyHint
          title="No cues to group yet"
          body="The timings imported but produced no cues. Reimport them, or lower words per line to regroup."
        />
      )}
    </>
  )
}
