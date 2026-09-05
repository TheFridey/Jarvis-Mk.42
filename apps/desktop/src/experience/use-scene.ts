'use client';
import { useCallback, useEffect, useState } from 'react';
import type { DesktopApprovalCommand, DesktopCognitionCommand, DesktopKernelSnapshot, DesktopProposalCommand, SceneIntent, SemanticScene } from '@jarvis/scene';
import type { KernelConnection, SceneTransport } from './scene-client.ts';
export function useScene(transport: SceneTransport) {
  const [scene, setScene] = useState<SemanticScene>(); const [kernel, setKernel] = useState<DesktopKernelSnapshot>(); const [connection, setConnection] = useState<KernelConnection>({ status: 'connecting' });
  useEffect(() => { const offScene = transport.subscribe(setScene); const offKernel = transport.subscribeKernel(setKernel); const offConnection = transport.subscribeConnection(setConnection); return () => { offScene(); offKernel(); offConnection(); transport.close(); }; }, [transport]);
  const submit = useCallback(async (intent: SceneIntent) => { if (!scene) return; await transport.submit(intent, scene.version); }, [scene, transport]);
  const submitProposal = useCallback((command: DesktopProposalCommand) => transport.submitProposal(command), [transport]);
  const submitCognition = useCallback((command: DesktopCognitionCommand) => transport.submitCognition(command), [transport]);
  const decideApproval = useCallback((command: DesktopApprovalCommand) => transport.decideApproval(command), [transport]);
  return { scene, kernel, connection, submit, submitProposal, submitCognition, decideApproval, reconnect: () => transport.reconnect() };
}
