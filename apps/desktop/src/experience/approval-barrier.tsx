'use client';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { DesktopApproval, DesktopApprovalCommand } from '@jarvis/scene';
import type { DataLiveness } from './experience-phase-policy.ts';
import type { SpatialLayout } from './spatial-layout-policy.ts';
import { useNow } from './use-viewport.ts';

function expiry(expiresAt: string | undefined, now: number): { text: string; urgent: boolean } {
  const at = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(at)) return { text: 'EXPIRY NOT DECLARED', urgent: false };
  const s = Math.round((at - now) / 1000);
  if (s <= 0) return { text: 'EXPIRED · AWAITING KERNEL', urgent: true };
  return { text: s < 120 ? `EXPIRES IN ${s}S` : `EXPIRES IN ${Math.round(s / 60)}M`, urgent: s < 60 };
}

/**
 * The execution barrier made legible: what will act, on what, why, at what
 * risk. Decisions go to the Kernel; the UI never presumes the outcome.
 */
export function ApprovalBarrier({ approvals, stateVersion, decide, liveness, layout }: { approvals: DesktopApproval[]; stateVersion: number; decide: (command: DesktopApprovalCommand) => Promise<void>; liveness: DataLiveness; layout: SpatialLayout }) {
  const approval = approvals[0];
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; text: string }>();
  const [confirmation, setConfirmation] = useState('');
  if (!approval) return null;
  const canDecide = liveness.current && !liveness.synthetic;
  const act = async (decision: 'approve' | 'deny') => {
    if (!canDecide) return;
    setBusy(true);
    try {
      await decide({ commandId: crypto.randomUUID(), expectedStateVersion: stateVersion, approvalId: approval.id, invocationId: approval.invocationId, nonce: approval.nonce!, version: approval.version!, decision, ...(confirmation ? { confirmationPhrase: confirmation } : {}) });
      setResult({ id: approval.id, text: decision === 'approve' ? 'Authorisation accepted by Kernel. Observe execution on the path.' : 'Denied by operator.' });
    } catch (error) { setResult({ id: approval.id, text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  const { text: expires, urgent } = expiry(approval.expiresAt, now);
  const width = 420;
  const style = layout.narrow ? undefined : { left: Math.max(24, layout.execution.barrier.x - width - 48), top: Math.max(84, Math.min(layout.height - 560, layout.core.y - 190)), width };
  const shown = result?.id === approval.id ? result.text : '';
  return <aside className={`approval-barrier risk-${approval.riskClass.toLowerCase()}`} style={style} aria-label="Approval required" role="alertdialog" aria-describedby={`approval-${approval.id}-summary`}>
    <header>
      <ShieldAlert size={16} aria-hidden="true"/>
      <div><small>EXECUTION BARRIER</small><strong>APPROVAL REQUIRED</strong></div>
      <span className="risk-badge">{approval.riskClass} RISK</span>
    </header>
    <h2>{approval.action ?? approval.summary}</h2>
    <p id={`approval-${approval.id}-summary`} className="approval-summary">{approval.reason}</p>
    <dl>
      <div><dt>CAPABILITY</dt><dd>{approval.capabilityId ?? 'UNAVAILABLE'}{approval.capabilityVersion ? ` · v${approval.capabilityVersion}` : ''}</dd></div>
      <div><dt>REQUESTED BY</dt><dd>{approval.actor}</dd></div>
      <div><dt>AFFECTS</dt><dd>{approval.resource}</dd></div>
      <div><dt>SCOPE</dt><dd>{approval.scopes.join(', ') || 'NO DECLARED SCOPES'}</dd></div>
      <div className={urgent ? 'urgent' : ''}><dt>WINDOW</dt><dd>{expires}</dd></div>
    </dl>
    <details className="approval-arguments"><summary>ARGUMENTS</summary><pre>{JSON.stringify(approval.arguments, null, 2)}</pre></details>
    {!liveness.current ? <p role="status" className="signal stale">Disconnected. Approval decisions are unavailable.</p> : liveness.synthetic ? <p role="status" className="signal">Demo mode · synthetic approval · decisions disabled.</p> : null}
    {approval.riskClass === 'CRITICAL' && canDecide ? <label className="confirmation">CONFIRMATION PHRASE<input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="Required confirmation phrase"/></label> : null}
    {shown ? <p role="status" className="approval-result">{shown}</p> : <div className="approval-actions">
      <button className="deny" disabled={busy || !canDecide} onClick={() => void act('deny')}>DENY</button>
      <button className="approve" disabled={busy || !canDecide} onClick={() => void act('approve')}>AUTHORISE</button>
    </div>}
    {approvals.length > 1 ? <p className="signal">+{approvals.length - 1} MORE PENDING</p> : null}
  </aside>;
}
