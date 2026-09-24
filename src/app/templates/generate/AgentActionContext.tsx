"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

type AgentActionContextValue = {
  validationRequest: number;
  requestValidation: () => void;
  validationState: "idle" | "validating" | "passed" | "failed" | "stale";
  validatedRevision: number | null;
  setValidationResult: (valid: boolean, revision: number) => void;
  markValidationStale: () => void;
  clearValidation: () => void;
  isAgentBusy: boolean;
  setAgentBusy: (busy: boolean) => void;
};

const AgentActionContext = createContext<AgentActionContextValue | null>(null);

/** 在编辑器验证按钮与右侧 Agent 面板之间传递动作，不把服务端页面整体改成客户端组件。 */
export function AgentActionProvider({ children }: { children: ReactNode }) {
  const [validationRequest, setValidationRequest] = useState(0);
  const [validationState, setValidationState] = useState<AgentActionContextValue["validationState"]>("idle");
  const [validatedRevision, setValidatedRevision] = useState<number | null>(null);
  const validationInvalidatedRef = useRef(false);
  const [isAgentBusy, setAgentBusy] = useState(false);
  const requestValidation = useCallback(() => {
    validationInvalidatedRef.current = false;
    setValidationState("validating");
    setValidatedRevision(null);
    setValidationRequest((request) => request + 1);
  }, []);
  const setValidationResult = useCallback((valid: boolean, revision: number) => {
    if (validationInvalidatedRef.current) {
      setValidationState("stale");
      setValidatedRevision(null);
      return;
    }
    setValidationState(valid ? "passed" : "failed");
    setValidatedRevision(valid ? revision : null);
  }, []);
  const markValidationStale = useCallback(() => {
    validationInvalidatedRef.current = true;
    setValidationState((current) =>
      current === "passed" || current === "validating" ? "stale" : current,
    );
    setValidatedRevision(null);
  }, []);
  const clearValidation = useCallback(() => {
    validationInvalidatedRef.current = false;
    setValidationState("idle");
    setValidatedRevision(null);
  }, []);
  const value = useMemo(
    () => ({
      validationRequest,
      requestValidation,
      validationState,
      validatedRevision,
      setValidationResult,
      markValidationStale,
      clearValidation,
      isAgentBusy,
      setAgentBusy,
    }),
    [clearValidation, isAgentBusy, markValidationStale, requestValidation, setValidationResult, validatedRevision, validationRequest, validationState],
  );

  return (
    <AgentActionContext.Provider value={value}>
      {children}
    </AgentActionContext.Provider>
  );
}

export function useAgentActions() {
  const context = useContext(AgentActionContext);
  if (!context) {
    throw new Error("useAgentActions must be used within AgentActionProvider.");
  }
  return context;
}
