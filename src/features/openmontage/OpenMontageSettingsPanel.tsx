import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  OpenMontageComponentHealth,
  OpenMontageHealthReport,
  OpenMontageSettings
} from '@shared/openmontage'
import { Btn, Card, StatusPill, ToggleRow } from '../../components/ui/kit'
import { useStore } from '../../store/useStore'

const EXPECTED_CREDENTIALS = ['Pexels', 'Pixabay', 'Unsplash', 'OpenAI', 'Google', 'ElevenLabs', 'Other providers']

function healthTone(status?: string): 'ok' | 'warn' | 'error' | 'neutral' {
  if (status === 'available' || status === 'ready' || status === 'compatible') return 'ok'
  if (status === 'limited' || status === 'degraded' || status === 'unknown') return 'warn'
  if (status === 'unavailable' || status === 'misconfigured' || status === 'incompatible') return 'error'
  return 'neutral'
}

function findComponent(
  health: OpenMontageHealthReport | null,
  name: OpenMontageComponentHealth['name']
): OpenMontageComponentHealth | undefined {
  return health?.components.find((component) => component.name === name)
}

function SettingsSection({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <Card style={{ marginBottom: 16 }} pad={18}>
      <div className="om-settings-section">
        <div className="om-settings-heading">
          <div className="om-section-kicker">{title}</div>
          <div>{description}</div>
        </div>
        <div className="om-settings-content">{children}</div>
      </div>
    </Card>
  )
}

function TextSetting({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label className="om-field">
      <span>{label}</span>
      <input
        className="ed-input ed-focus"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function OpenMontageSettingsPanel(): JSX.Element {
  const settings = useStore((state) => state.settings.integrations.openMontage)
  const updateSettings = useStore((state) => state.updateSettings)
  const [health, setHealth] = useState<OpenMontageHealthReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const save = useCallback((patch: Partial<OpenMontageSettings>) => {
    updateSettings({ integrations: { openMontage: patch } })
  }, [updateSettings])

  const checkHealth = useCallback(async (force = false) => {
    setChecking(true)
    setError('')
    try {
      setHealth(await window.api.openMontage.health(force))
    } catch (cause) {
      setHealth(null)
      setError(cause instanceof Error ? cause.message : 'OpenMontage health check failed.')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (settings.enabled) void checkHealth(false)
  }, [checkHealth, settings.enabled])

  const credentials = useMemo(() => {
    return EXPECTED_CREDENTIALS.map((label) => {
      const needle = label.toLowerCase().replace('other providers', '')
      const match = health?.credentials.find((item) => (
        needle ? item.provider.toLowerCase().includes(needle) : false
      ))
      return { label, configured: match?.configured ?? false, source: match?.source }
    })
  }, [health])

  const capabilityComponents: Array<{ label: string; name: OpenMontageComponentHealth['name'] }> = [
    { label: 'Remotion', name: 'remotion' },
    { label: 'HyperFrames', name: 'hyperframes' },
    { label: 'Backlot', name: 'backlot' },
    { label: 'FFmpeg', name: 'ffmpeg' },
    { label: 'Python environment', name: 'python' }
  ]

  return (
    <div className="om-settings-root">
      <SettingsSection
        title="Installation"
        description="Connect MES to an external OpenMontage checkout. The repository remains independently owned and updated."
      >
        <ToggleRow
          on={settings.enabled}
          label="Enable OpenMontage"
          hint="Adds production planning, assisted handoffs, and managed execution to MES."
          onToggle={() => save({ enabled: !settings.enabled })}
        />
        <div className="om-settings-divider" />
        <TextSetting
          label="OpenMontage repository location"
          value={settings.repositoryPath}
          placeholder="D:\Tools\OpenMontage"
          onChange={(repositoryPath) => save({ repositoryPath })}
        />
        <TextSetting
          label="Python executable"
          value={settings.pythonExecutable}
          placeholder="python"
          onChange={(pythonExecutable) => save({ pythonExecutable })}
        />
        <TextSetting
          label="Backlot URL"
          value={settings.backlotUrl}
          placeholder="http://127.0.0.1:5150"
          onChange={(backlotUrl) => save({ backlotUrl })}
        />
        <div className="om-inline-results">
          <StatusPill tone={healthTone(findComponent(health, 'installation')?.status)}>
            {health?.installedRevision ? `Revision ${health.installedRevision.slice(0, 9)}` : 'Version not checked'}
          </StatusPill>
          <StatusPill tone={healthTone(health?.compatibility)}>
            {health?.compatibility ? `${health.compatibility} contract` : 'Compatibility unknown'}
          </StatusPill>
          <Btn variant="soft" disabled={checking || !settings.enabled} onClick={() => void checkHealth(true)}>
            {checking ? 'Validating…' : 'Validate installation'}
          </Btn>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Agent Runner"
        description="Assisted mode prepares a durable handoff. Managed mode supervises a local agent process."
      >
        <label className="om-field">
          <span>Runner selection</span>
          <select
            className="ed-input ed-focus"
            value={settings.runner}
            onChange={(event) => save({ runner: event.target.value as OpenMontageSettings['runner'] })}
          >
            <option value="none">No managed runner</option>
            <option value="codex-cli">Codex CLI</option>
            <option value="claude-code">Claude Code</option>
            <option value="custom">Custom executable</option>
          </select>
        </label>
        <TextSetting
          label="Executable location"
          value={settings.runnerExecutable}
          placeholder="codex"
          onChange={(runnerExecutable) => save({ runnerExecutable })}
        />
        <div className="om-settings-toggle-stack">
          <ToggleRow
            on={settings.mode === 'managed'}
            label="Managed mode"
            hint="MES starts, monitors, pauses, and recovers the selected local runner."
            onToggle={() => save({ mode: settings.mode === 'managed' ? 'assisted' : 'managed' })}
          />
          <ToggleRow
            on={settings.assistedFallback}
            label="Assisted fallback"
            hint="Prepare a recoverable handoff when the managed runner is unavailable."
            onToggle={() => save({ assistedFallback: !settings.assistedFallback })}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Capabilities"
        description="Availability is detected from the configured external installation; MES does not vendor these runtimes."
      >
        <div className="om-capability-settings-grid">
          {capabilityComponents.map(({ label, name }) => {
            const component = findComponent(health, name)
            return (
              <div className="om-capability-setting" key={name}>
                <div>
                  <strong>{label}</strong>
                  <span>{component?.detail || 'Run a health check to inspect this capability.'}</span>
                </div>
                <StatusPill tone={healthTone(component?.status)}>{component?.status || 'unknown'}</StatusPill>
              </div>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Credentials"
        description="Credential values stay in the OpenMontage or runner environment. MES only receives configured/not-configured status."
      >
        <div className="om-credential-grid">
          {credentials.map((credential) => (
            <div className="om-credential-row" key={credential.label}>
              <span>{credential.label}</span>
              <StatusPill tone={credential.configured ? 'ok' : 'neutral'}>
                {credential.configured ? 'Configured' : 'Not detected'}
              </StatusPill>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Reliability"
        description="Bound retries and stalls, preserve recoverable work, and keep telemetry sanitized."
      >
        <div className="om-reliability-grid">
          <label className="om-field">
            <span>Retry limit</span>
            <input
              type="number"
              min={0}
              max={10}
              className="ed-input ed-focus"
              value={settings.retryLimit}
              onChange={(event) => save({ retryLimit: Math.max(0, Math.min(10, Number(event.target.value))) })}
            />
          </label>
          <label className="om-field">
            <span>Stall timeout</span>
            <div className="om-input-suffix">
              <input
                type="number"
                min={30}
                max={3600}
                className="ed-input ed-focus"
                value={settings.stallTimeoutSec}
                onChange={(event) => save({ stallTimeoutSec: Math.max(30, Math.min(3600, Number(event.target.value))) })}
              />
              <span>seconds</span>
            </div>
          </label>
        </div>
        <div className="om-settings-toggle-stack">
          <ToggleRow
            on={settings.automaticMesFallback}
            label="Automatic MES fallback"
            hint="Use the original local MES compose pipeline after an eligible OpenMontage failure."
            onToggle={() => save({ automaticMesFallback: !settings.automaticMesFallback })}
          />
          <ToggleRow
            on={settings.preserveFailedProjects}
            label="Preserve failed projects"
            hint="Keep packages, checkpoints, decisions, and external workspace files for recovery."
            onToggle={() => save({ preserveFailedProjects: !settings.preserveFailedProjects })}
          />
          <ToggleRow
            on={settings.sendSanitizedErrorsToSentry}
            label="Send sanitized errors to Sentry"
            hint="Report categories and references without prompts, credentials, or provider payloads."
            onToggle={() => save({ sendSanitizedErrorsToSentry: !settings.sendSanitizedErrorsToSentry })}
          />
        </div>
      </SettingsSection>

      <Card className="om-health-footer" pad={18}>
        <div>
          <div className="om-section-kicker">Health results</div>
          <strong>{error || (health ? `OpenMontage is ${health.status}` : 'No health check has run yet')}</strong>
          <span>
            {health?.warnings.length
              ? health.warnings.join(' · ')
              : health ? `Checked ${new Date(health.checkedAt).toLocaleString()}` : 'Validate the installation to populate capabilities and provider status.'}
          </span>
        </div>
        <Btn variant="primary" disabled={checking || !settings.enabled} onClick={() => void checkHealth(true)}>
          {checking ? 'Checking…' : 'Run Full Health Check'}
        </Btn>
      </Card>
    </div>
  )
}
