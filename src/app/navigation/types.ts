export type RootStackParamList = {
  Connection: undefined;
  Auth: undefined;
  Workspaces: undefined;
  Boards: {
    workspaceId: string;
    workspaceName: string;
  };
  Board: {
    workspaceId: string;
    boardId: string;
    boardName: string;
    focusCardId?: string;
  };
  Activity: {
    boardId: string;
    boardName: string;
  };
  Settings: undefined;
};
