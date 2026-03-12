import { create } from 'zustand'

interface TasksState {
  runningCount: number
  setRunningCount: (count: number) => void
}

export const useTasksStore = create<TasksState>((set) => ({
  runningCount: 0,
  setRunningCount: (count) => set({ runningCount: count }),
}))
