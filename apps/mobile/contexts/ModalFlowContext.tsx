import React, { createContext, useContext, useState, useCallback } from "react";

interface ModalFlowContextType {
  isReceiveModalVisible: boolean;
  isSendModalVisible: boolean;
  showReceiveModal: () => void;
  showSendModal: () => void;
  hideAllModals: () => void;
}

const ModalFlowContext = createContext<ModalFlowContextType | undefined>(
  undefined
);

/**
 * Holds visibility only. The screen that is open renders the modals, so a
 * Send tapped from the tab bar shows on whatever screen the Consumer is on.
 */
export function ModalFlowProvider({ children }: { children: React.ReactNode }) {
  const [isReceiveModalVisible, setIsReceiveModalVisible] = useState(false);
  const [isSendModalVisible, setIsSendModalVisible] = useState(false);

  const showReceiveModal = useCallback(() => {
    setIsReceiveModalVisible(true);
  }, []);

  const showSendModal = useCallback(() => {
    setIsSendModalVisible(true);
  }, []);

  const hideAllModals = useCallback(() => {
    setIsReceiveModalVisible(false);
    setIsSendModalVisible(false);
  }, []);

  return (
    <ModalFlowContext.Provider
      value={{
        isReceiveModalVisible,
        isSendModalVisible,
        showReceiveModal,
        showSendModal,
        hideAllModals,
      }}
    >
      {children}
    </ModalFlowContext.Provider>
  );
}

export function useModalFlow() {
  const context = useContext(ModalFlowContext);
  if (context === undefined) {
    throw new Error("useModalFlow must be used within a ModalFlowProvider");
  }
  return context;
}
