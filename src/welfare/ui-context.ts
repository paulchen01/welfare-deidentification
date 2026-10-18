import type { WorkspaceSession, WorkspaceView } from './session';
import type { WelfareSample } from './types';

export interface UIContext {
  session:WorkspaceSession;
  view:WorkspaceView;
  busy:boolean;
  rawInput:string;
  render:()=>void;
  go:(view:WorkspaceView)=>void;
  run:(work:(signal:AbortSignal)=>Promise<void>)=>void;
  notify:(message:string)=>void;
  addText:(text:string)=>void;
  addFiles:(files:File[])=>void;
  useSample:(sample:WelfareSample)=>void;
  clear:()=>void;
  invalidate:()=>void;
}
