"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type AgentActionContextValue = {
  validationRequest: number;
  requestValidation: () => void;
  isAgentBusy: boolean;
  setAgentBusy: (busy: boolean) => void;
};

const AgentActionContext = createContext<AgentActionContextValue | null>(null);

/** 在编辑器验证按钮与右侧 Agent 面板之间传递动作，不把服务端页面整体改成客户端组件。 */
export function AgentActionProvider({ children }: { children: ReactNode }) {
  const [validationRequest, setValidationRequest] = useState(0);
  const [isAgentBusy, setAgentBusy] = useState(false);
  const requestValidation = useCallback(() => {
    setValidationRequest((request) => request + 1);
  }, []);
  const value = useMemo(
    () => ({
      validationRequest,
      requestValidation,
      isAgentBusy,
      setAgentBusy,
    }),
    [isAgentBusy, requestValidation, validationRequest],
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

