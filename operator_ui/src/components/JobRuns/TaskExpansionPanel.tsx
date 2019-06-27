import React from 'react'
import Grid from '@material-ui/core/Grid'
import StatusItem from './StatusItem'
import capitalize from 'lodash/capitalize'
import { IInitiator, ITaskRuns, IJobRun } from '../../../@types/operator_ui'
import { createStyles } from '@material-ui/core'
import { withStyles, WithStyles } from '@material-ui/core/styles'

const fontStyles = () =>
  createStyles({
    header: {
      fontFamily: 'Roboto Mono',
      fontWeight: 'bold',
      fontSize: '14px',
      color: '#818ea3'
    },
    subHeader: {
      fontFamily: 'Roboto Mono',
      fontSize: '12px',
      color: '#818ea3'
    }
  })

interface IItemProps extends WithStyles<typeof fontStyles> {
  keyOne: string
  valOne: string
  keyTwo: string
  valTwo: string
}

const Item = withStyles(fontStyles)(
  ({ keyOne, valOne, keyTwo, valTwo, classes }: IItemProps) => (
    <Grid container>
      <Grid item sm={2}>
        <p className={classes.header}>{keyOne}</p>
        <p className={classes.subHeader}>{valOne || 'No Value Available'}</p>
      </Grid>
      <Grid item md={10}>
        <p className={classes.header}>{keyTwo}</p>
        <p className={classes.subHeader}>{valTwo || 'No Value Available'}</p>
      </Grid>
    </Grid>
  )
)

const renderInitiator = (params: object) => {
  const paramsArr = Object.entries(params)

  return (
    <>
      {JSON.stringify(paramsArr) === '[]' ? (
        <Item
          keyOne="Initiator Params"
          valOne="Value"
          keyTwo="Values"
          valTwo="No input Parameters"
        />
      ) : (
        paramsArr.map((par, idx) => (
          <Item
            keyOne="Initiator Params"
            valOne={par[0]}
            keyTwo="Values"
            valTwo={par[1]}
            key={idx}
          />
        ))
      )}
    </>
  )
}

const Params = (params: object) => {
  return (
    <div>
      {Object.entries(params).map((par, idx) => (
        <Item
          keyOne="Params"
          valOne={par[0]}
          keyTwo="Values"
          valTwo={par[1]}
          key={idx}
        />
      ))}
    </div>
  )
}

const Result = (taskRun: ITaskRun) => {
  const result =
    taskRun.result && taskRun.result.data && taskRun.result.data.result

  return (
    <Item
      keyOne="Result"
      valOne="Task Run Data"
      keyTwo="Values"
      valTwo={result}
    />
  )
}

const TaskExpansionPanel = ({ children }: { children: IJobRun }) => {
  const initiator: IInitiator = children.initiator
  const taskRuns: ITaskRuns = children.taskRuns

  return (
    <Grid container spacing={0}>
      <Grid item xs={12}>
        <StatusItem
          summary={capitalize(initiator.type)}
          status={children.status}
          borderTop={false}
          confirmations={0}
          minConfirmations={0}
        >
          {renderInitiator(initiator.params)}
        </StatusItem>
      </Grid>
      {taskRuns.map(taskRun => (
        <Grid item xs={12} key={taskRun.id}>
          <StatusItem
            summary={capitalize(taskRun.task.type)}
            status={taskRun.status}
            confirmations={taskRun.task.confirmations}
            minConfirmations={taskRun.minimumConfirmations}
          >
            <Grid container direction="column">
              <Grid item>
                {taskRun.task && <Params params={taskRun.task.params} />}
              </Grid>
              <Grid item>
                <Result run={taskRun} />
              </Grid>
            </Grid>
          </StatusItem>
        </Grid>
      ))}
    </Grid>
  )
}

export default TaskExpansionPanel
