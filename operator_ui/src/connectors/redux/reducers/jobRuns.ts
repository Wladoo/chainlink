export interface IState {
  items: any
  currentPage?: number
  currentJobRunsCount?: number
}

const initialState = {
  items: {},
  currentPage: undefined,
  currentJobRunsCount: undefined
}

export const UPSERT_JOB_RUNS = 'UPSERT_JOB_RUNS'
export const UPSERT_RECENT_JOB_RUNS = 'UPSERT_RECENT_JOB_RUNS'
export const UPSERT_JOB_RUN = 'UPSERT_JOB_RUN'
export const UPSERT_JOB = 'UPSERT_JOB'

export type Action =
  | { type: 'UPSERT_JOB_RUNS'; data: any }
  | { type: 'UPSERT_RECENT_JOB_RUNS'; data: any }
  | { type: 'UPSERT_JOB_RUN'; data: any }
  | { type: 'UPSERT_JOB'; data: any }

export default (state: IState = initialState, action: Action) => {
  switch (action.type) {
    case 'UPSERT_JOB_RUNS': {
      return Object.assign(
        {},
        state,
        { items: Object.assign({}, state.items, action.data.runs) },
        {
          currentPage: action.data.meta.currentPageJobRuns.data.map(
            (r: any) => r.id
          )
        },
        { currentJobRunsCount: action.data.meta.currentPageJobRuns.meta.count }
      )
    }
    case 'UPSERT_RECENT_JOB_RUNS':
    case 'UPSERT_JOB_RUN':
    case 'UPSERT_JOB': {
      return Object.assign({}, state, {
        items: Object.assign({}, state.items, action.data.runs)
      })
    }
    default:
      return state
  }
}
