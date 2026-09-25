import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import AddTaskIcon from '@mui/icons-material/AddTask';
import BoltIcon from '@mui/icons-material/Bolt';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PsychologyAltOutlinedIcon from '@mui/icons-material/PsychologyAltOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';

const queueColumns = [
  { id: 'ready', label: 'Ready', hint: '取得可能', icon: BoltIcon },
  { id: 'in_progress', label: 'Working', hint: 'Agentが実行中', icon: SmartToyOutlinedIcon },
  { id: 'blocked', label: 'Blocked', hint: '判断・外部条件待ち', icon: WarningAmberOutlinedIcon },
  { id: 'review', label: 'Review', hint: '確認・引継ぎ待ち', icon: TaskAltOutlinedIcon },
];

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
const priorityLabel = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value) => {
  const millis = toMillis(value);
  if (!millis) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis));
};

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function Dashboard() {
  const [workItems, setWorkItems] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [runs, setRuns] = useState([]);
  const [memos, setMemos] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [draft, setDraft] = useState({
    title: '',
    objective: '',
    priority: 'medium',
    spaceId: '',
    projectId: '',
  });
  const theme = useTheme();
  const navigate = useNavigate();
  const isDark = theme.palette.mode === 'dark';

  useEffect(() => {
    const unsubscribers = [
      onSnapshot(collection(db, 'memos', 'agent-control', 'workItems'), (snapshot) => {
        setWorkItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      }),
      onSnapshot(collection(db, 'spaces'), (snapshot) => {
        setSpaces(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      }),
      onSnapshot(collection(db, 'projects'), (snapshot) => {
        setProjects(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      }),
      onSnapshot(collection(db, 'runs'), (snapshot) => {
        setRuns(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      }),
      onSnapshot(collection(db, 'memos'), (snapshot) => {
        setMemos(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const openWork = useMemo(
    () => workItems.filter((item) => !['done', 'cancelled'].includes(item.status)),
    [workItems],
  );

  const activeSpaces = useMemo(
    () => spaces
      .filter((item) => item.status === 'active')
      .sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt)),
    [spaces],
  );

  const activeProjects = useMemo(
    () => projects
      .filter((item) => !['done', 'completed', 'archived', 'cancelled'].includes(String(item.status || '').toLowerCase()))
      .sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt)),
    [projects],
  );

  const activeRuns = useMemo(
    () => runs
      .filter((item) => item.status === 'active')
      .sort((a, b) => toMillis(b.updatedAt || b.startedAt) - toMillis(a.updatedAt || a.startedAt)),
    [runs],
  );

  const actionMemos = useMemo(
    () => memos
      .filter((item) => ['next_action', 'inbox', 'project'].includes(item.status))
      .sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt))
      .slice(0, 8),
    [memos],
  );

  const unqueuedActions = useMemo(() => {
    const output = [];
    activeSpaces.forEach((space) => {
      (space.nextActions || []).forEach((action) => {
        const normalized = clean(action).toLowerCase();
        const exists = openWork.some((item) => (
          item.spaceId === space.id &&
          [item.title, item.objective].some((value) => clean(value).toLowerCase() === normalized)
        ));
        if (!exists && normalized) output.push({ space, action });
      });
    });
    return output.slice(0, 10);
  }, [activeSpaces, openWork]);

  const border = isDark
    ? alpha(theme.palette.common.white, 0.1)
    : 'rgba(73, 112, 138, 0.16)';
  const glass = isDark
    ? alpha(theme.palette.background.paper, 0.84)
    : 'rgba(255,255,255,0.76)';

  const createWorkItem = async (preset = null) => {
    const source = preset || draft;
    const title = clean(source.title);
    if (!title) {
      setCreateError('タイトルは必須です。');
      return;
    }

    try {
      setCreateError('');
      await addDoc(collection(db, 'memos', 'agent-control', 'workItems'), {
        title,
        objective: clean(source.objective),
        instructions: '',
        status: 'ready',
        priority: source.priority || 'medium',
        spaceId: source.spaceId || null,
        projectId: source.projectId || null,
        sourceType: source.sourceType || 'manual',
        sourceId: source.sourceId || null,
        dependencies: [],
        tags: [],
        claimedBy: null,
        claimedModel: null,
        runId: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        blockedReason: '',
        resultSummary: '',
        nextActions: [],
        metadata: {},
        revision: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDraft({ title: '', objective: '', priority: 'medium', spaceId: '', projectId: '' });
      setCreateOpen(false);
    } catch (error) {
      console.error('Failed to create work item:', error);
      setCreateError('Work Itemの作成に失敗しました。');
    }
  };

  const queueFor = (status) => openWork
    .filter((item) => item.status === status)
    .sort((a, b) => {
      const priorityDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (priorityDiff !== 0) return priorityDiff;
      return toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt);
    });

  const kpis = [
    { label: 'Ready', value: queueFor('ready').length + queueFor('backlog').length, sub: '着手可能' },
    { label: 'Working', value: queueFor('in_progress').length, sub: activeRuns.length + ' active runs' },
    { label: 'Blocked', value: queueFor('blocked').length, sub: '要判断 / 外部待ち' },
    {
      label: 'Coverage',
      value: activeSpaces.length + activeProjects.length,
      sub: activeSpaces.length + ' spaces / ' + activeProjects.length + ' projects',
    },
  ];

  return (
    <Box sx={{ minHeight: '100%', pb: 4 }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 1.6, md: 2.2 },
          mb: 1.5,
          border: '1px solid ' + border,
          background: glass,
          backdropFilter: 'blur(18px) saturate(135%)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            alignItems: { xs: 'flex-start', md: 'center' },
            flexDirection: { xs: 'column', md: 'row' },
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography
              variant="overline"
              sx={{ fontWeight: 900, letterSpacing: '0.14em', color: 'text.secondary' }}
            >
              AGENT CONTROL PLANE
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.035em' }}>
              Agent HQ
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.7, maxWidth: 850, lineHeight: 1.7 }}
            >
              ここをエージェントの作業管制塔として使います。Work Itemを取得して実行し、
              Space / Project / Run の文脈を引き継ぎながら、複数エージェントが競合せず並列に進められる状態を可視化します。
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              startIcon={<PsychologyAltOutlinedIcon />}
              onClick={() => navigate('/thinking')}
            >
              思考テーマ
            </Button>
            <Button
              variant="outlined"
              startIcon={<FolderOutlinedIcon />}
              onClick={() => navigate('/project')}
            >
              Projects
            </Button>
            <Button
              variant="contained"
              startIcon={<AddTaskIcon />}
              onClick={() => setCreateOpen(true)}
            >
              Work Item追加
            </Button>
          </Stack>
        </Box>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 1,
          mb: 1.5,
        }}
      >
        {kpis.map((item) => (
          <Paper
            key={item.label}
            elevation={0}
            sx={{ p: 1.4, border: '1px solid ' + border, background: glass }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
              {item.label}
            </Typography>
            <Typography variant="h4" sx={{ mt: 0.2, fontWeight: 900 }}>
              {item.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.sub}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 2.2fr) minmax(300px, 0.8fr)' },
          gap: 1.5,
          mb: 1.5,
        }}
      >
        <Paper
          elevation={0}
          sx={{ p: 1.25, border: '1px solid ' + border, background: glass, minWidth: 0 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <HubOutlinedIcon color="primary" />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                Execution Queue
              </Typography>
              <Typography variant="caption" color="text.secondary">
                claimされた仕事はWorkingへ移り、完了・レビュー・ブロックまで履歴を残します。
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(2, 1fr)',
                xl: 'repeat(4, 1fr)',
              },
              gap: 1,
            }}
          >
            {queueColumns.map((column) => {
              const Icon = column.icon;
              const items = queueFor(column.id);
              return (
                <Box key={column.id} sx={{ minWidth: 0 }}>
                  <Box sx={{ px: 0.5, py: 0.6, display: 'flex', alignItems: 'center', gap: 0.6 }}>
                    <Icon sx={{ fontSize: 18 }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                      {column.label}
                    </Typography>
                    <Chip
                      size="small"
                      label={items.length}
                      sx={{ height: 20, ml: 'auto', fontSize: '0.62rem' }}
                    />
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ px: 0.5, display: 'block', mb: 0.7 }}
                  >
                    {column.hint}
                  </Typography>

                  <Stack spacing={0.8}>
                    {items.slice(0, 8).map((item) => (
                      <Card
                        key={item.id}
                        elevation={0}
                        sx={{
                          border: '1px solid ' + border,
                          background: isDark
                            ? alpha(theme.palette.background.paper, 0.92)
                            : 'rgba(255,255,255,0.9)',
                        }}
                      >
                        <CardContent sx={{ p: '11px !important' }}>
                          <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'flex-start' }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 850, lineHeight: 1.4, flex: 1 }}
                            >
                              {item.title || 'Untitled'}
                            </Typography>
                            <Chip
                              size="small"
                              label={priorityLabel[item.priority] || 'MEDIUM'}
                              variant="outlined"
                              sx={{ height: 18, fontSize: '0.52rem' }}
                            />
                          </Box>

                          {item.objective && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                mt: 0.55,
                                lineHeight: 1.45,
                              }}
                            >
                              {item.objective}
                            </Typography>
                          )}

                          <Box
                            sx={{
                              display: 'flex',
                              gap: 0.5,
                              alignItems: 'center',
                              mt: 0.8,
                              flexWrap: 'wrap',
                            }}
                          >
                            {item.claimedBy && (
                              <Chip
                                size="small"
                                icon={<SmartToyOutlinedIcon />}
                                label={item.claimedBy}
                                sx={{ height: 20, fontSize: '0.58rem' }}
                              />
                            )}
                            {item.spaceId && (
                              <Chip
                                size="small"
                                label="Space"
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.58rem' }}
                              />
                            )}
                            {item.projectId && (
                              <Chip
                                size="small"
                                label="Project"
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.58rem' }}
                              />
                            )}
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ ml: 'auto', fontSize: '0.58rem' }}
                            >
                              {formatDate(item.updatedAt || item.createdAt)}
                            </Typography>
                          </Box>

                          {item.blockedReason && (
                            <Alert
                              severity="warning"
                              sx={{
                                mt: 0.8,
                                py: 0,
                                '& .MuiAlert-message': { fontSize: '0.68rem' },
                              }}
                            >
                              {item.blockedReason}
                            </Alert>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    {items.length === 0 && (
                      <Box
                        sx={{
                          p: 1.4,
                          border: '1px dashed ' + border,
                          borderRadius: 2,
                          textAlign: 'center',
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          なし
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Paper>

        <Stack spacing={1.5}>
          <Paper
            elevation={0}
            sx={{ p: 1.25, border: '1px solid ' + border, background: glass }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 0.9 }}>
              <SmartToyOutlinedIcon color="primary" />
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                Active Agents
              </Typography>
              <Chip size="small" label={activeRuns.length} sx={{ ml: 'auto', height: 21 }} />
            </Box>
            <Stack spacing={0.7}>
              {activeRuns.slice(0, 8).map((run) => (
                <Box
                  key={run.id}
                  sx={{ p: 0.9, borderRadius: 2, border: '1px solid ' + border }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 900 }}>
                    {run.agent || 'agent'}
                    {run.model ? ' · ' + run.model : ''}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ mt: 0.2, fontSize: '0.75rem', lineHeight: 1.45 }}
                  >
                    {run.objective || 'Run in progress'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(run.updatedAt || run.startedAt)}
                  </Typography>
                </Box>
              ))}
              {activeRuns.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  現在アクティブなRunはありません。
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper
            elevation={0}
            sx={{ p: 1.25, border: '1px solid ' + border, background: glass }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Unqueued Next Actions
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Spaceにはあるが、まだ実行キュー化されていない次の行動。
            </Typography>
            <Stack spacing={0.7} sx={{ mt: 1 }}>
              {unqueuedActions.map(({ space, action }) => (
                <Box
                  key={space.id + ':' + action}
                  sx={{ p: 0.8, borderRadius: 2, border: '1px solid ' + border }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                    {space.title}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.2, fontSize: '0.75rem' }}>
                    {action}
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<AddTaskIcon />}
                    sx={{ mt: 0.5 }}
                    onClick={() => createWorkItem({
                      title: action,
                      objective: action,
                      priority: 'medium',
                      spaceId: space.id,
                      projectId: '',
                      sourceType: 'space_next_action',
                      sourceId: space.id,
                    })}
                  >
                    キューへ
                  </Button>
                </Box>
              ))}
              {unqueuedActions.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  未キュー化のNext Actionはありません。
                </Typography>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gap: 1.5,
          mb: 1.5,
        }}
      >
        <Paper
          elevation={0}
          sx={{ p: 1.25, border: '1px solid ' + border, background: glass }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1 }}>
            <PsychologyAltOutlinedIcon color="primary" />
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Spaces · 再開地点
            </Typography>
            <Chip size="small" label={activeSpaces.length} sx={{ ml: 'auto', height: 21 }} />
          </Box>
          <Stack spacing={0.8}>
            {activeSpaces.slice(0, 8).map((space) => (
              <Box
                key={space.id}
                sx={{ p: 1, borderRadius: 2, border: '1px solid ' + border, cursor: 'pointer' }}
                onClick={() => navigate('/thinking')}
              >
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  {space.title}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    mt: 0.35,
                    lineHeight: 1.45,
                  }}
                >
                  {space.currentBrief || space.goal || space.summary || 'Briefなし'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.7 }}>
                  <Chip
                    size="small"
                    label={(space.nextActions || []).length + ' next'}
                    variant="outlined"
                    sx={{ height: 20, fontSize: '0.58rem' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    {formatDate(space.updatedAt || space.createdAt)}
                  </Typography>
                </Box>
              </Box>
            ))}
            {activeSpaces.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Active Spaceはありません。
              </Typography>
            )}
          </Stack>
        </Paper>

        <Paper
          elevation={0}
          sx={{ p: 1.25, border: '1px solid ' + border, background: glass }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1 }}>
            <FolderOutlinedIcon color="primary" />
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Projects · 実行単位
            </Typography>
            <Chip size="small" label={activeProjects.length} sx={{ ml: 'auto', height: 21 }} />
          </Box>
          <Stack spacing={0.8}>
            {activeProjects.slice(0, 8).map((project) => (
              <Box
                key={project.id}
                sx={{ p: 1, borderRadius: 2, border: '1px solid ' + border, cursor: 'pointer' }}
                onClick={() => navigate('/project/details/' + project.id)}
              >
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  {project.name || 'Untitled Project'}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    mt: 0.35,
                    lineHeight: 1.45,
                  }}
                >
                  {project.description || '説明なし'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.7 }}>
                  {project.status && (
                    <Chip
                      size="small"
                      label={project.status}
                      sx={{ height: 20, fontSize: '0.58rem' }}
                    />
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    {formatDate(project.updatedAt || project.createdAt)}
                  </Typography>
                </Box>
              </Box>
            ))}
            {activeProjects.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Active Projectはありません。
              </Typography>
            )}
          </Stack>
        </Paper>
      </Box>

      <Paper
        elevation={0}
        sx={{ p: 1.25, border: '1px solid ' + border, background: glass }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 0.9 }}>
          <PauseCircleOutlineIcon color="primary" />
          <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
            Legacy Inbox · 捕捉漏れ候補
          </Typography>
          <Chip size="small" label={actionMemos.length} sx={{ ml: 'auto', height: 21 }} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          従来メモの next_action / inbox / project。必要なものはWork Itemへ昇格させます。
        </Typography>
        <Divider sx={{ my: 1 }} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' },
            gap: 0.8,
          }}
        >
          {actionMemos.map((memo) => (
            <Box
              key={memo.id}
              sx={{ p: 0.9, borderRadius: 2, border: '1px solid ' + border }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 800,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {clean(memo.text) || '無題のメモ'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, mt: 0.7, alignItems: 'center' }}>
                <Chip
                  size="small"
                  label={memo.status}
                  sx={{ height: 19, fontSize: '0.55rem' }}
                />
                <Button
                  size="small"
                  sx={{ ml: 'auto' }}
                  onClick={() => navigate('/memo/' + memo.id)}
                >
                  開く
                </Button>
              </Box>
            </Box>
          ))}
          {actionMemos.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              対象メモはありません。
            </Typography>
          )}
        </Box>
      </Paper>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Work Itemを追加</DialogTitle>
        <DialogContent>
          <Stack spacing={1.4} sx={{ mt: 0.5 }}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <TextField
              label="タイトル"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))}
              autoFocus
            />
            <TextField
              label="目的 / 完了条件"
              value={draft.objective}
              onChange={(event) => setDraft((current) => ({
                ...current,
                objective: event.target.value,
              }))}
              multiline
              minRows={3}
            />
            <FormControl>
              <InputLabel>優先度</InputLabel>
              <Select
                label="優先度"
                value={draft.priority}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  priority: event.target.value,
                }))}
              >
                <MenuItem value="critical">Critical</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="low">Low</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Space</InputLabel>
              <Select
                label="Space"
                value={draft.spaceId}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  spaceId: event.target.value,
                }))}
              >
                <MenuItem value="">紐付けなし</MenuItem>
                {activeSpaces.map((space) => (
                  <MenuItem key={space.id} value={space.id}>
                    {space.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Project</InputLabel>
              <Select
                label="Project"
                value={draft.projectId}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  projectId: event.target.value,
                }))}
              >
                <MenuItem value="">紐付けなし</MenuItem>
                {activeProjects.map((project) => (
                  <MenuItem key={project.id} value={project.id}>
                    {project.name || project.id}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>キャンセル</Button>
          <Button
            variant="contained"
            startIcon={<AddTaskIcon />}
            onClick={() => createWorkItem()}
          >
            追加
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Dashboard;
