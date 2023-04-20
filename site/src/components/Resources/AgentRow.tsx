import Popover from "@material-ui/core/Popover"
import { makeStyles, useTheme } from "@material-ui/core/styles"
import { Skeleton } from "@material-ui/lab"
import { useMachine } from "@xstate/react"
import CodeOutlined from "@material-ui/icons/CodeOutlined"
import {
  CloseDropdown,
  OpenDropdown,
} from "components/DropdownArrows/DropdownArrows"
import { LogLine, logLineHeight } from "components/Logs/Logs"
import { PortForwardButton } from "components/PortForwardButton/PortForwardButton"
import { VSCodeDesktopButton } from "components/VSCodeDesktopButton/VSCodeDesktopButton"
import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { darcula } from "react-syntax-highlighter/dist/cjs/styles/prism"
import AutoSizer from "react-virtualized-auto-sizer"
import { FixedSizeList as List, ListOnScrollProps } from "react-window"
import { colors } from "theme/colors"
import { combineClasses } from "utils/combineClasses"
import {
  LineWithID,
  workspaceAgentLogsMachine,
} from "xServices/workspaceAgentLogs/workspaceAgentLogsXService"
import {
  Workspace,
  WorkspaceAgent,
  WorkspaceAgentMetadata,
} from "../../api/typesGenerated"
import { AppLink } from "../AppLink/AppLink"
import { SSHButton } from "../SSHButton/SSHButton"
import { Stack } from "../Stack/Stack"
import { TerminalLink } from "../TerminalLink/TerminalLink"
import { AgentLatency } from "./AgentLatency"
import { AgentMetadata } from "./AgentMetadata"
import { AgentVersion } from "./AgentVersion"
import { AgentStatus } from "./AgentStatus"

export interface AgentRowProps {
  agent: WorkspaceAgent
  workspace: Workspace
  applicationsHost: string | undefined
  showApps: boolean
  hideSSHButton?: boolean
  sshPrefix?: string
  hideVSCodeDesktopButton?: boolean
  serverVersion: string
  onUpdateAgent: () => void
  storybookStartupLogs?: LineWithID[]
  storybookAgentMetadata?: WorkspaceAgentMetadata[]
}

export const AgentRow: FC<AgentRowProps> = ({
  agent,
  workspace,
  applicationsHost,
  showApps,
  hideSSHButton,
  hideVSCodeDesktopButton,
  serverVersion,
  onUpdateAgent,
  storybookStartupLogs,
  storybookAgentMetadata,
  sshPrefix,
}) => {
  const styles = useStyles()
  const [logsMachine, sendLogsEvent] = useMachine(workspaceAgentLogsMachine, {
    context: { agentID: agent.id },
    services: process.env.STORYBOOK
      ? {
          getStartupLogs: async () => {
            return storybookStartupLogs || []
          },
          streamStartupLogs: () => async () => {
            // noop
          },
        }
      : undefined,
  })
  const theme = useTheme()
  const startupScriptAnchorRef = useRef<HTMLButtonElement>(null)
  const [startupScriptOpen, setStartupScriptOpen] = useState(false)
  const hasAppsToDisplay = !hideVSCodeDesktopButton || agent.apps.length > 0
  const shouldDisplayApps =
    showApps &&
    ((agent.status === "connected" && hasAppsToDisplay) ||
      agent.status === "connecting")
  const hasStartupFeatures =
    Boolean(agent.startup_logs_length) ||
    Boolean(logsMachine.context.startupLogs?.length)

  const [showStartupLogs, setShowStartupLogs] = useState(
    agent.lifecycle_state !== "ready" && hasStartupFeatures,
  )
  useEffect(() => {
    setShowStartupLogs(agent.lifecycle_state !== "ready" && hasStartupFeatures)
  }, [agent.lifecycle_state, hasStartupFeatures])
  // External applications can provide startup logs for an agent during it's spawn.
  // These could be Kubernetes logs, or other logs that are useful to the user.
  // For this reason, we want to fetch these logs when the agent is starting.
  useEffect(() => {
    if (agent.lifecycle_state === "starting") {
      sendLogsEvent("FETCH_STARTUP_LOGS")
    }
  }, [sendLogsEvent, agent.lifecycle_state])
  useEffect(() => {
    // We only want to fetch logs when they are actually shown,
    // otherwise we can make a lot of requests that aren't necessary.
    if (showStartupLogs) {
      sendLogsEvent("FETCH_STARTUP_LOGS")
    }
  }, [sendLogsEvent, showStartupLogs])
  const logListRef = useRef<List>(null)
  const logListDivRef = useRef<HTMLDivElement>(null)
  const startupLogs = useMemo(() => {
    const allLogs = logsMachine.context.startupLogs || []

    const logs = [...allLogs]
    if (agent.startup_logs_overflowed) {
      logs.push({
        id: -1,
        level: "error",
        output: "Startup logs exceeded the max size of 1MB!",
        time: new Date().toISOString(),
      })
    }
    return logs
  }, [logsMachine.context.startupLogs, agent.startup_logs_overflowed])
  const [bottomOfLogs, setBottomOfLogs] = useState(true)
  // This is a layout effect to remove flicker when we're scrolling to the bottom.
  useLayoutEffect(() => {
    // If we're currently watching the bottom, we always want to stay at the bottom.
    if (bottomOfLogs && logListRef.current) {
      logListRef.current.scrollToItem(startupLogs.length - 1, "end")
    }
  }, [showStartupLogs, startupLogs, logListRef, bottomOfLogs])

  // This is a bit of a hack on the react-window API to get the scroll position.
  // If we're scrolled to the bottom, we want to keep the list scrolled to the bottom.
  // This makes it feel similar to a terminal that auto-scrolls downwards!
  const handleLogScroll = useCallback(
    (props: ListOnScrollProps) => {
      if (
        props.scrollOffset === 0 ||
        props.scrollUpdateWasRequested ||
        !logListDivRef.current
      ) {
        return
      }
      // The parent holds the height of the list!
      const parent = logListDivRef.current.parentElement
      if (!parent) {
        return
      }
      const distanceFromBottom =
        logListDivRef.current.scrollHeight -
        (props.scrollOffset + parent.clientHeight)
      setBottomOfLogs(distanceFromBottom < logLineHeight)
    },
    [logListDivRef],
  )

  return (
    <Stack
      key={agent.id}
      direction="column"
      spacing={0}
      className={combineClasses([
        styles.agentRow,
        styles[`agentRow-${agent.status}`],
        styles[`agentRow-lifecycle-${agent.lifecycle_state}`],
      ])}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={6}
        className={styles.agentInfo}
      >
        <div className={styles.agentNameAndStatus}>
          <Stack alignItems="center" direction="row" spacing={3}>
            <AgentStatus agent={agent} />
            <div className={styles.agentName}>{agent.name}</div>
            <Stack
              direction="row"
              spacing={2}
              alignItems="baseline"
              className={styles.agentDescription}
            >
              {agent.status === "connected" && (
                <>
                  <span className={styles.agentOS}>
                    {agent.operating_system}
                  </span>
                  <AgentVersion
                    agent={agent}
                    serverVersion={serverVersion}
                    onUpdate={onUpdateAgent}
                  />
                  <AgentLatency agent={agent} />
                </>
              )}
              {agent.status === "connecting" && (
                <>
                  <Skeleton width={160} variant="text" />
                  <Skeleton width={36} variant="text" />
                </>
              )}
            </Stack>
          </Stack>
        </div>

        {agent.status === "connected" && (
          <div className={styles.agentDefaultActions}>
            <TerminalLink
              workspaceName={workspace.name}
              agentName={agent.name}
              userName={workspace.owner_name}
            />
            {!hideSSHButton && (
              <SSHButton
                workspaceName={workspace.name}
                agentName={agent.name}
                sshPrefix={sshPrefix}
              />
            )}
            {applicationsHost !== undefined && applicationsHost !== "" && (
              <PortForwardButton
                host={applicationsHost}
                workspaceName={workspace.name}
                agentId={agent.id}
                agentName={agent.name}
                username={workspace.owner_name}
              />
            )}
          </div>
        )}

        {agent.status === "connecting" && (
          <div className={styles.agentDefaultActions}>
            <Skeleton
              width={80}
              height={32}
              variant="rect"
              className={styles.buttonSkeleton}
            />
            <Skeleton
              width={110}
              height={32}
              variant="rect"
              className={styles.buttonSkeleton}
            />
          </div>
        )}
      </Stack>

      <AgentMetadata storybookMetadata={storybookAgentMetadata} agent={agent} />

      {shouldDisplayApps && (
        <div className={styles.apps}>
          {agent.status === "connected" && (
            <>
              {!hideVSCodeDesktopButton && (
                <VSCodeDesktopButton
                  userName={workspace.owner_name}
                  workspaceName={workspace.name}
                  agentName={agent.name}
                  folderPath={agent.expanded_directory}
                />
              )}
              {agent.apps.map((app) => (
                <AppLink
                  key={app.slug}
                  appsHost={applicationsHost}
                  app={app}
                  agent={agent}
                  workspace={workspace}
                />
              ))}
            </>
          )}

          {agent.status === "connecting" && (
            <>
              <Skeleton
                width={80}
                height={36}
                variant="rect"
                className={styles.buttonSkeleton}
              />
              <Skeleton
                width={110}
                height={36}
                variant="rect"
                className={styles.buttonSkeleton}
              />
            </>
          )}
        </div>
      )}

      {hasStartupFeatures && (
        <div className={styles.logsPanel}>
          {showStartupLogs && (
            <AutoSizer disableHeight>
              {({ width }) => (
                <List
                  ref={logListRef}
                  innerRef={logListDivRef}
                  height={256}
                  itemCount={startupLogs.length}
                  itemSize={logLineHeight}
                  width={width}
                  className={styles.startupLogs}
                  onScroll={handleLogScroll}
                >
                  {({ index, style }) => (
                    <LogLine
                      line={startupLogs[index]}
                      number={index + 1}
                      style={style}
                    />
                  )}
                </List>
              )}
            </AutoSizer>
          )}
          <div className={styles.logsPanelButtons}>
            {showStartupLogs ? (
              <button
                className={combineClasses([
                  styles.logsPanelButton,
                  styles.toggleLogsButton,
                ])}
                onClick={() => {
                  setShowStartupLogs((v) => !v)
                }}
              >
                <CloseDropdown />
                Hide startup logs
              </button>
            ) : (
              <button
                className={combineClasses([
                  styles.logsPanelButton,
                  styles.toggleLogsButton,
                ])}
                onClick={() => {
                  setShowStartupLogs((v) => !v)
                }}
              >
                <OpenDropdown />
                Show startup logs
              </button>
            )}

            <button
              className={combineClasses([
                styles.logsPanelButton,
                styles.scriptButton,
              ])}
              ref={startupScriptAnchorRef}
              onClick={() => {
                setStartupScriptOpen(!startupScriptOpen)
              }}
            >
              <CodeOutlined />
              Startup scripts
            </button>

            <Popover
              classes={{
                paper: styles.startupScriptPopover,
              }}
              open={startupScriptOpen}
              onClose={() => setStartupScriptOpen(false)}
              anchorEl={startupScriptAnchorRef.current}
            >
              <div>
                <SyntaxHighlighter
                  style={darcula}
                  language="shell"
                  showLineNumbers
                  // Use inline styles does not work correctly
                  // https://github.com/react-syntax-highlighter/react-syntax-highlighter/issues/329
                  codeTagProps={{ style: {} }}
                  customStyle={{
                    background: theme.palette.background.default,
                    maxWidth: 600,
                    margin: 0,
                  }}
                >
                  {agent.startup_script || ""}
                </SyntaxHighlighter>
              </div>
            </Popover>
          </div>
        </div>
      )}
    </Stack>
  )
}

const useStyles = makeStyles((theme) => ({
  agentRow: {
    backgroundColor: theme.palette.background.paperLight,
    fontSize: 16,
    borderLeft: `2px solid ${theme.palette.text.secondary}`,

    "&:not(:first-child)": {
      borderTop: `2px solid ${theme.palette.divider}`,
    },
  },

  "agentRow-connected": {
    borderLeftColor: theme.palette.success.light,
  },

  "agentRow-disconnected": {
    borderLeftColor: theme.palette.text.secondary,
  },

  "agentRow-connecting": {
    borderLeftColor: theme.palette.info.light,
  },

  "agentRow-timeout": {
    borderLeftColor: theme.palette.warning.light,
  },

  "agentRow-lifecycle-created": {},

  "agentRow-lifecycle-starting": {
    borderLeftColor: theme.palette.info.light,
  },

  "agentRow-lifecycle-ready": {
    borderLeftColor: theme.palette.success.light,
  },

  "agentRow-lifecycle-start_timeout": {
    borderLeftColor: theme.palette.warning.light,
  },

  "agentRow-lifecycle-start_error": {
    borderLeftColor: theme.palette.error.light,
  },

  "agentRow-lifecycle-shutting_down": {
    borderLeftColor: theme.palette.info.light,
  },

  "agentRow-lifecycle-shutdown_timeout": {
    borderLeftColor: theme.palette.warning.light,
  },

  "agentRow-lifecycle-shutdown_error": {
    borderLeftColor: theme.palette.error.light,
  },

  "agentRow-lifecycle-off": {
    borderLeftColor: theme.palette.text.secondary,
  },

  agentInfo: {
    padding: theme.spacing(2, 4),
  },

  agentDefaultActions: {
    display: "flex",
    gap: theme.spacing(1),
    marginLeft: "auto",
  },

  agentDescription: {
    fontSize: 14,
    color: theme.palette.text.secondary,
  },

  startupLogs: {
    maxHeight: 256,
    borderBottom: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    paddingTop: theme.spacing(2),

    // We need this to be able to apply the padding top from startupLogs
    "& > div": {
      position: "relative",
    },
  },

  startupScriptPopover: {
    backgroundColor: theme.palette.background.default,
  },

  agentNameAndStatus: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(4),
  },

  agentName: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 260,
    fontWeight: 600,
    fontSize: theme.spacing(2),
  },

  agentDataGroup: {
    display: "flex",
    alignItems: "baseline",
    gap: theme.spacing(6),
  },

  agentData: {
    display: "flex",
    flexDirection: "column",
    fontSize: 12,

    "& > *:first-child": {
      fontWeight: 500,
      color: theme.palette.text.secondary,
    },
  },

  apps: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(1.5),
    padding: theme.spacing(4),
    borderTop: `1px solid ${theme.palette.divider}`,
  },

  logsPanel: {
    borderTop: `1px solid ${theme.palette.divider}`,
  },

  logsPanelButtons: {
    display: "flex",
  },

  logsPanelButton: {
    textAlign: "left",
    background: "transparent",
    border: 0,
    fontFamily: "inherit",
    padding: theme.spacing(1.5, 4),
    color: theme.palette.text.secondary,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    whiteSpace: "nowrap",

    "&:hover": {
      color: theme.palette.text.primary,
      backgroundColor: colors.gray[14],
    },

    "& svg": {
      color: "inherit",
    },
  },

  toggleLogsButton: {
    width: "100%",
  },

  buttonSkeleton: {
    borderRadius: 4,
  },

  agentErrorMessage: {
    fontSize: 12,
    fontWeight: 400,
    marginTop: theme.spacing(0.5),
    color: theme.palette.warning.light,
  },

  scriptButton: {
    "& svg": {
      width: theme.spacing(2),
      height: theme.spacing(2),
    },
  },

  agentOS: {
    textTransform: "capitalize",
  },
}))
