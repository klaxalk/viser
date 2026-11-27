import * as React from "react";
import * as Messages from "../WebsocketMessages";

interface GuiComponentContext {
  folderDepth: number;
  setValue: (id: string, value: NonNullable<unknown>) => void;
  messageSender: (message: Messages.Message) => void;
  // ModelForge: send the update the throttle holds back now (a form submit
  // must not overtake, or replace, the last keystrokes' value update).
  flushMessages: () => void;
  GuiContainer: React.FC<{ containerUuid: string; unwrapped?: boolean }>;
}

export const GuiComponentContext = React.createContext<GuiComponentContext>({
  folderDepth: 0,
  setValue: () => undefined,
  messageSender: () => undefined,
  flushMessages: () => undefined,
  GuiContainer: () => {
    throw new Error("GuiComponentContext not initialized");
  },
});
