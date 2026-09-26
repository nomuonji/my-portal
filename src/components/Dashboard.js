import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import ManagerJobsPanel from './ManagerJobsPanel';
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
  FormControl,
  InputLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { useNavigate } from 'react-router-dom';
import AddTaskIcon from '@mui/icons-material/AddTask';
import BoltIcon from '@mui/icons-material/Bolt';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import PsychologyAltOutlinedIcon from '@mui/icons-material/PsychologyAltOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

const queueColumns = [
  { id: 'backlog', label: 'Backlog', hint: '明示的に後回し', icon: Inventory2OutlinedIcon },
  { id: 'ready', label: 'Ready', hint: '取得可能', icon: BoltIcon },
  { id: 'in_progress', label: 'Working', hint: '進行中・再開可能', icon: PendingActionsOutlinedIcon },
  { id: 'running', label: 'Running', hint: 'いま作業中', icon: SmartToyOutlinedIcon },
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

function PixelPerson({ kind = 'worker', size = 44 }) {
  const palette = {
    owner: { shirt: '#9c6ade', accent: '#f5c2e7' },
    manager: { shirt: '#4f8cff', accent: '#9ec5ff' },
    worker: { shirt: '#45b77a', accent: '#9be5bc' },
    human: { shirt: '#e59b42', accent: '#ffd59a' },
  };
  const colors = palette[kind] || palette.worker;
  const scale = size / 11;

  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        position: 'relative',
        flexShrink: 0,
        imageRendering: 'pixelated',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: 4 * scale,
          top: 1 * scale,
          width: 3 * scale,
          height: 3 * scale,
          bgcolor: '#f2c7a5',
          boxShadow: `
            -${1 * scale}px ${1 * scale}px 0 #f2c7a5,
            ${1 * scale}px ${1 * scale}px 0 #f2c7a5
          `,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: 3 * scale,
          top: 0,
          width: 5 * scale,
          height: 1 * scale,
          bgcolor: '#3d342f',
          boxShadow: `
            0 ${1 * scale}px 0 #3d342f,
            -${1 * scale}px ${1 * scale}px 0 #3d342f
          `,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: 3 * scale,
          top: 5 * scale,
          width: 5 * scale,
          height: 3 * scale,
          bgcolor: colors.shirt,
          boxShadow: `
            -${1 * scale}px ${1 * scale}px 0 ${colors.shirt},
            ${5 * scale}px ${1 * scale}px 0 ${colors.shirt}
          `,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: 3 * scale,
          top: 8 * scale,
          width: 2 * scale,
          height: 2 * scale,
          bgcolor: colors.accent,
          boxShadow: `${3 * scale}px 0 0 ${colors.accent}`,
        }}
      />
    </Box>
  );
}

function OfficeRole({ kind, title, subtitle, count }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.9,
        minWidth: 0,
        px: 1,
        py: 0.8,
        borderRadius: 1.5,
      }}
    >
      <PixelPerson kind={kind} size={40} />
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 950 }}>
            {title}
          </Typography>
          {count !== undefined && (
            <Chip size="small" label={count} sx={{ height: 18, fontSize: '0.55rem' }} />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.25 }}>
          {subtitle}
        </Typography>
      </Box>
    </Box>
  );
}

function Dashboard() {
  const [workItems, setWorkItems] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [linearOverview, setLinearOverview] = useState({
    configured: null,
    issues: [],
    unlinkedIssues: [],
  });
  const [linearLoading, setLinearLoading] = useState(false);
  const [linearError, setLinearError] = useState('');
  const [linearImporting, setLinearImporting] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [draft, setDraft] = useState({
    title: '',
    objective: '',
    priority: 'medium',
    executionMode: 'agent',
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
      onSnapshot(collection(db, 'projects'), (snapshot) => {
        setProjects(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const loadControlPlane = async ({ quiet = false } = {}) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      if (!quiet) setLinearLoading(true);
      setLinearError('');
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/agent-ideas?resource=control_plane&limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Control Planeの取得に失敗しました。');
      setSpaces(payload.activeSpaces || []);
      setLinearOverview({
        configured: payload.linear?.configured === true,
        issues: payload.linear?.issues || [],
        unlinkedIssues: payload.linear?.unlinkedIssues || [],
        error: payload.linear?.error || '',
      });
      if (payload.linear?.error) setLinearError(payload.linear.error);
    } catch (error) {
      console.error('Failed to load Linear control plane:', error);
      setLinearError(error.message || 'Linearの取得に失敗しました。');
    } finally {
      if (!quiet) setLinearLoading(false);
    }
  };

  useEffect(() => {
    loadControlPlane();
    const interval = window.setInterval(() => loadControlPlane({ quiet: true }), 60000);
    return () => window.clearInterval(interval);
    // Agent HQ mounts only for an authenticated user; auth.currentUser is read at request time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importLinearIssue = async (issue) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !issue?.id) return;
    try {
      setLinearImporting(issue.id);
      setLinearError('');
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/agent-ideas', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'linear_issue_import',
          issue: issue.id,
          executionMode: 'agent',
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Work Item化に失敗しました。');
      await loadControlPlane({ quiet: true });
    } catch (error) {
      console.error('Failed to import Linear issue:', error);
      setLinearError(error.message || 'Linear IssueのWork Item化に失敗しました。');
    } finally {
      setLinearImporting('');
    }
  };

  const openWork = useMemo(
    () => workItems.filter((item) => !['archived', 'done', 'cancelled'].includes(item.status)),
    [workItems],
  );

  const humanTasks = useMemo(
    () => openWork
      .filter((item) => item.executionMode === 'human')
      .sort((a, b) => {
        const priorityDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
        if (priorityDiff !== 0) return priorityDiff;
        return toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt);
      }),
    [openWork],
  );

  const allAgentWork = useMemo(
    () => workItems.filter((item) => (item.executionMode || 'agent') === 'agent'),
    [workItems],
  );

  const agentWork = useMemo(
    () => allAgentWork.filter((item) => !['archived', 'done', 'cancelled'].includes(item.status)),
    [allAgentWork],
  );

  const completedWork = useMemo(
    () => workItems
      .filter((item) => ['archived', 'done', 'cancelled'].includes(item.status))
      .sort((a, b) => toMillis(b.finishedAt || b.updatedAt || b.createdAt) - toMillis(a.finishedAt || a.updatedAt || a.createdAt)),
    [workItems],
  );

  const recentCompletedWork = useMemo(() => {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return completedWork
      .filter((item) => toMillis(item.finishedAt || item.updatedAt || item.createdAt) >= cutoff)
      .slice(0, 8);
  }, [completedWork]);

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

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );


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
        executionMode: source.executionMode || 'agent',
        humanReason: clean(source.humanReason),
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
      setDraft({ title: '', objective: '', priority: 'medium', executionMode: 'agent', spaceId: '', projectId: '' });
      setCreateOpen(false);
    } catch (error) {
      console.error('Failed to create work item:', error);
      setCreateError('Work Itemの作成に失敗しました。');
    }
  };


  const completeHumanTask = async (item) => {
    try {
      await updateDoc(doc(db, 'memos', 'agent-control', 'workItems', item.id), {
        status: 'archived',
        completedBy: 'human',
        finishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        revision: Number(item.revision || 1) + 1,
      });
    } catch (error) {
      console.error('Failed to complete human task:', error);
    }
  };

  const returnHumanTaskToAgent = async (item) => {
    try {
      await updateDoc(doc(db, 'memos', 'agent-control', 'workItems', item.id), {
        executionMode: 'agent',
        status: 'ready',
        humanReason: '',
        requestedBy: null,
        updatedAt: serverTimestamp(),
        revision: Number(item.revision || 1) + 1,
      });
    } catch (error) {
      console.error('Failed to return human task to agent:', error);
    }
  };

  const moveWorkItem = async (item, nextStatus) => {
    if (!item?.id || !nextStatus) return;
    const currentStatus = ['done', 'cancelled'].includes(item.status) ? 'archived' : item.status;
    if (nextStatus === currentStatus) return;

    try {
      const patch = {
        status: nextStatus,
        updatedAt: serverTimestamp(),
        revision: Number(item.revision || 1) + 1,
      };

      // Manual movement into Running is allowed. It marks the card as active,
      // but leaves ownership empty until an Agent actually claims it.
      if (nextStatus === 'running') {
        patch.claimedBy = null;
        patch.claimedModel = null;
        patch.runId = null;
        patch.leaseExpiresAt = null;
        patch.lastHeartbeatAt = null;
      }

      // Leaving an Agent-owned Running state from the UI is an explicit human override.
      if (currentStatus === 'running' && nextStatus !== 'running') {
        patch.claimedBy = null;
        patch.claimedModel = null;
        patch.runId = null;
        patch.leaseExpiresAt = null;
        patch.lastHeartbeatAt = serverTimestamp();
      }

      if (nextStatus === 'archived') {
        patch.completedBy = 'human';
        patch.finishedAt = serverTimestamp();
      } else {
        patch.completedBy = null;
        patch.finishedAt = null;
      }

      await updateDoc(doc(db, 'memos', 'agent-control', 'workItems', item.id), patch);
    } catch (error) {
      console.error('Failed to move work item:', error);
    }
  };

  const deleteWorkItem = async (item) => {
    if (!item?.id) return;
    const label = item.title || 'このWork Item';
    if (!window.confirm(`「${label}」を完全に削除しますか？`)) return;
    try {
      await deleteDoc(doc(db, 'memos', 'agent-control', 'workItems', item.id));
    } catch (error) {
      console.error('Failed to delete work item:', error);
    }
  };

  const handleWorkItemDragEnd = ({ draggableId, source, destination }) => {
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;
    const item = allAgentWork.find((candidate) => candidate.id === draggableId);
    if (!item) return;
    moveWorkItem(item, destination.droppableId);
  };

  const queueFor = (status) => agentWork
    .filter((item) => item.status === status)
    .sort((a, b) => {
      const priorityDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (priorityDiff !== 0) return priorityDiff;
      return toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt);
    });

  const kpis = [
    { label: '仕事待ち', value: queueFor('ready').length, sub: 'Workerが取れる仕事' },
    { label: '作業中', value: queueFor('running').length + queueFor('in_progress').length, sub: 'Agentが進めている仕事' },
    { label: '要確認', value: queueFor('blocked').length + queueFor('review').length, sub: '詰まり・確認待ち' },
    { label: 'あなた待ち', value: humanTasks.length, sub: '本人の操作・判断' },
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
              AGENT OFFICE
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.035em' }}>
              Agent HQ
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.7, maxWidth: 760, lineHeight: 1.7 }}
            >
              小さな会社のように、あなたが方針を決め、マネージャーが仕事を見つけ、Workerが実行します。
              My Portalはその「会社の状態」を見る場所です。
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

      <Paper
        elevation={0}
        sx={{
          p: 0.8,
          mb: 1.2,
          border: '1px solid ' + border,
          background: glass,
          overflowX: 'auto',
        }}
      >
        <Box
          sx={{
            minWidth: { xs: 620, md: 0 },
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr auto 1fr auto 1fr',
            alignItems: 'center',
            gap: 0.25,
          }}
        >
          <OfficeRole kind="owner" title="あなた" subtitle="方針・承認" count={humanTasks.length} />
          <Typography color="text.disabled" sx={{ fontWeight: 900 }}>→</Typography>
          <OfficeRole kind="manager" title="マネージャー" subtitle="仕事を見つける" />
          <Typography color="text.disabled" sx={{ fontWeight: 900 }}>→</Typography>
          <OfficeRole kind="worker" title="Worker" subtitle="実際に作業する" count={queueFor('running').length} />
          <Typography color="text.disabled" sx={{ fontWeight: 900 }}>→</Typography>
          <OfficeRole kind="human" title="確認デスク" subtitle="詰まり・レビュー" count={queueFor('blocked').length + queueFor('review').length} />
        </Box>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
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
            <Typography variant="h5" sx={{ mt: 0.2, fontWeight: 900 }}>
              {item.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.sub}
            </Typography>
          </Paper>
        ))}
      </Box>

      <ManagerJobsPanel projects={projects} />

      <Paper
        elevation={0}
        sx={{
          p: 1.25,
          mb: 1.5,
          border: '1px solid ' + border,
          background: glass,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 0.9, flexWrap: 'wrap' }}>
          <HubOutlinedIcon color="primary" />
          <Box sx={{ flex: 1, minWidth: 180 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Linear Inbox
            </Typography>
            <Typography variant="caption" color="text.secondary">
              外部から入ってきた仕事。必要なものだけ社内の仕事（Work Item）として取り込みます。
            </Typography>
          </Box>
          <Chip
            size="small"
            label={linearOverview.configured === false
              ? '未接続'
              : `未取込 ${linearOverview.unlinkedIssues.length} / Open ${linearOverview.issues.length}`}
            sx={{ height: 21 }}
          />
          <Button size="small" onClick={() => loadControlPlane()} disabled={linearLoading}>
            {linearLoading ? '更新中…' : '更新'}
          </Button>
        </Box>

        {linearError && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {linearError}
          </Alert>
        )}

        {linearOverview.configured === false ? (
          <Alert severity="info">
            LINEAR_API_KEYがまだ利用できません。Netlifyの環境変数を確認してください。
          </Alert>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' },
              gap: 0.8,
            }}
          >
            {linearOverview.unlinkedIssues.slice(0, 18).map((issue) => (
              <Card key={issue.id} elevation={0} sx={{ border: '1px solid ' + border }}>
                <CardContent sx={{ p: '12px !important' }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.6 }}>
                    <Typography variant="body2" sx={{ fontWeight: 900, flex: 1 }}>
                      {issue.id} · {issue.title || 'Untitled'}
                    </Typography>
                    <Chip
                      size="small"
                      label={issue.status || issue.statusType || 'Linear'}
                      variant="outlined"
                      sx={{ height: 18, fontSize: '0.52rem' }}
                    />
                  </Box>

                  {issue.description && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mt: 0.55,
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {issue.description}
                    </Typography>
                  )}

                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {issue.project && (
                      <Chip size="small" label={typeof issue.project === 'string' ? issue.project : issue.project.name} sx={{ height: 19, fontSize: '0.55rem' }} />
                    )}
                    {issue.assignee && (
                      <Chip size="small" label={typeof issue.assignee === 'string' ? issue.assignee : issue.assignee.name} variant="outlined" sx={{ height: 19, fontSize: '0.55rem' }} />
                    )}
                    {(issue.labels || []).slice(0, 3).map((label) => (
                      <Chip
                        key={typeof label === 'string' ? label : label.name}
                        size="small"
                        label={typeof label === 'string' ? label : label.name}
                        variant="outlined"
                        sx={{ height: 19, fontSize: '0.55rem' }}
                      />
                    ))}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 0.6, mt: 1, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => importLinearIssue(issue)}
                      disabled={linearImporting === issue.id}
                    >
                      {linearImporting === issue.id ? '取込中…' : 'Work Item化'}
                    </Button>
                    {issue.url && (
                      <Button
                        size="small"
                        component="a"
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Linear
                      </Button>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', alignSelf: 'center' }}>
                      {formatDate(issue.updatedAt)}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            ))}
            {!linearLoading && linearOverview.configured !== false && linearOverview.unlinkedIssues.length === 0 && (
              <Box sx={{ p: 1.4, border: '1px dashed ' + border, borderRadius: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  未取り込みのLinear Issueはありません。
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: 1.25,
          mb: 1.5,
          border: '1px solid ' + border,
          background: glass,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 0.9 }}>
          <PersonOutlineIcon color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Human Tasks
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ログイン・承認・本人判断など、あなたにしかできない仕事です。
            </Typography>
          </Box>
          <Chip size="small" label={humanTasks.length} sx={{ height: 21 }} />
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' },
            gap: 0.8,
          }}
        >
          {humanTasks.slice(0, 12).map((item) => (
            <Card key={item.id} elevation={0} sx={{ border: '1px solid ' + border }}>
              <CardContent sx={{ p: '12px !important' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.6 }}>
                  <Typography variant="body2" sx={{ fontWeight: 900, flex: 1 }}>
                    {item.title || 'Untitled'}
                  </Typography>
                  <Chip
                    size="small"
                    label={priorityLabel[item.priority] || 'MEDIUM'}
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.52rem' }}
                  />
                </Box>

                {(item.humanReason || item.objective) && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.55, lineHeight: 1.5 }}>
                    {item.humanReason || item.objective}
                  </Typography>
                )}

                {item.resultSummary && (
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.6, lineHeight: 1.5 }}>
                    Agent側完了: {item.resultSummary}
                  </Typography>
                )}

                {item.projectId && (
                  <Chip
                    size="small"
                    label={'Project · ' + (projectById.get(item.projectId)?.name || item.projectId)}
                    variant="outlined"
                    clickable={projectById.has(item.projectId)}
                    onClick={projectById.has(item.projectId)
                      ? () => navigate('/project/details/' + item.projectId)
                      : undefined}
                    sx={{ height: 20, fontSize: '0.58rem', mt: 0.7 }}
                  />
                )}

                <Box sx={{ display: 'flex', gap: 0.6, mt: 1, flexWrap: 'wrap' }}>
                  <Button size="small" variant="contained" onClick={() => completeHumanTask(item)}>
                    完了
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => returnHumanTaskToAgent(item)}>
                    Agentへ戻す
                  </Button>
                  <IconButton
                    size="small"
                    color="error"
                    title="削除"
                    aria-label="Human Taskを削除"
                    onClick={() => deleteWorkItem(item)}
                    sx={{ width: 28, height: 28 }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                  {item.metadata?.linear?.url && (
                    <Button
                      size="small"
                      component="a"
                      href={item.metadata.linear.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Linear
                    </Button>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', alignSelf: 'center' }}>
                    {formatDate(item.updatedAt || item.createdAt)}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
          {humanTasks.length === 0 && (
            <Box sx={{ p: 1.4, border: '1px dashed ' + border, borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                現在、人間の対応待ちはありません。
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr',
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
                Workerの仕事
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Workerへ渡す仕事の流れです。ドラッグで状態を動かせます。
              </Typography>
            </Box>
          </Box>

          <DragDropContext onDragEnd={handleWorkItemDragEnd}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 1,
              }}
            >
              {queueColumns.map((column) => {
              const Icon = column.icon;
              const items = queueFor(column.id);
              return (
                <Droppable
                  key={column.id}
                  droppableId={column.id}
                >
                  {(dropProvided, dropSnapshot) => (
                    <Box
                      ref={dropProvided.innerRef}
                      {...dropProvided.droppableProps}
                      sx={{
                        minWidth: 0,
                        borderRadius: 2,
                        outline: dropSnapshot.isDraggingOver
                          ? '2px solid ' + alpha(theme.palette.primary.main, 0.45)
                          : '2px solid transparent',
                        background: dropSnapshot.isDraggingOver
                          ? alpha(theme.palette.primary.main, isDark ? 0.08 : 0.04)
                          : 'transparent',
                        transition: 'background 120ms ease, outline 120ms ease',
                      }}
                    >
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
                    {items.slice(0, 8).map((item, index) => (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(dragProvided, dragSnapshot) => (
                          <Card
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            elevation={dragSnapshot.isDragging ? 5 : 0}
                            sx={{
                              border: '1px solid ' + border,
                              background: isDark
                                ? alpha(theme.palette.background.paper, 0.92)
                                : 'rgba(255,255,255,0.9)',
                              opacity: dragSnapshot.isDragging ? 0.92 : 1,
                            }}
                          >
                            <CardContent sx={{ p: '11px !important' }}>
                          <Box sx={{ display: 'flex', gap: 0.45, alignItems: 'flex-start' }}>
                            <Box
                              {...dragProvided.dragHandleProps}
                              title="ドラッグして移動"
                              sx={{
                                display: 'grid',
                                placeItems: 'center',
                                mt: '-2px',
                                ml: '-4px',
                                width: 24,
                                height: 24,
                                borderRadius: 1,
                                color: 'text.disabled',
                                cursor: 'grab',
                                flexShrink: 0,
                                '&:active': { cursor: 'grabbing' },
                              }}
                            >
                              <DragIndicatorIcon sx={{ fontSize: 18 }} />
                            </Box>
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
                                label="長期テーマ"
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.58rem' }}
                              />
                            )}
                            {item.projectId && (
                              <Chip
                                size="small"
                                label={'Project · ' + (projectById.get(item.projectId)?.name || item.projectId)}
                                variant="outlined"
                                clickable={projectById.has(item.projectId)}
                                onClick={projectById.has(item.projectId)
                                  ? () => navigate('/project/details/' + item.projectId)
                                  : undefined}
                                sx={{ height: 20, fontSize: '0.58rem', maxWidth: '100%' }}
                              />
                            )}
                            {item.metadata?.linear && (
                              <Chip
                                size="small"
                                label={'Linear · ' + (item.metadata.linear.identifier || item.metadata.linear.issueId || 'linked')}
                                variant="outlined"
                                component={item.metadata.linear.url ? 'a' : 'div'}
                                href={item.metadata.linear.url || undefined}
                                target={item.metadata.linear.url ? '_blank' : undefined}
                                rel={item.metadata.linear.url ? 'noreferrer' : undefined}
                                clickable={Boolean(item.metadata.linear.url)}
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

                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.45 }}>
                            <IconButton
                              size="small"
                              color="error"
                              title="削除"
                              aria-label="Work Itemを削除"
                              onClick={() => deleteWorkItem(item)}
                              sx={{ width: 26, height: 26 }}
                            >
                              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Box>                            </CardContent>
                          </Card>
                        )}
                      </Draggable>
                    ))}
                    {dropProvided.placeholder}
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
                  )}
                </Droppable>
              );
            })}
            </Box>
          </DragDropContext>
        </Paper>

        <Paper
          elevation={0}
          sx={{ p: 1.25, border: '1px solid ' + border, background: glass }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 0.9, flexWrap: 'wrap' }}>
            <TaskAltOutlinedIcon color="primary" />
            <Box sx={{ flex: 1, minWidth: 180 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                最近の完了
              </Typography>
              <Typography variant="caption" color="text.secondary">
                作業ボードからは外れた完了履歴です。直近7日だけ表示し、古い履歴は運用データとして残します。
              </Typography>
            </Box>
            <Chip size="small" label={'7日間 ' + recentCompletedWork.length} sx={{ height: 21 }} />
            {completedWork.length > recentCompletedWork.length && (
              <Chip
                size="small"
                variant="outlined"
                label={'全履歴 ' + completedWork.length}
                sx={{ height: 21 }}
              />
            )}
          </Box>

          <Stack spacing={0.65}>
            {recentCompletedWork.map((item) => (
              <Box
                key={item.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) auto' },
                  gap: 0.6,
                  alignItems: 'center',
                  p: 0.8,
                  borderRadius: 1.3,
                  bgcolor: alpha(theme.palette.text.primary, isDark ? 0.04 : 0.025),
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 850 }}>
                      {item.title || 'Untitled'}
                    </Typography>
                    {item.sourceType === 'manager_job' && (
                      <Chip size="small" label="Manager配下" variant="outlined" sx={{ height: 18, fontSize: '0.52rem' }} />
                    )}
                    {item.completedBy && (
                      <Chip size="small" label={item.completedBy} sx={{ height: 18, fontSize: '0.52rem' }} />
                    )}
                  </Box>
                  {item.resultSummary && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mt: 0.25,
                        lineHeight: 1.35,
                      }}
                    >
                      {item.resultSummary}
                    </Typography>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {formatDate(item.finishedAt || item.updatedAt || item.createdAt)}
                </Typography>
              </Box>
            ))}
            {recentCompletedWork.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                直近7日に完了した仕事はありません。
              </Typography>
            )}
          </Stack>
        </Paper>

      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: 1.5,
          mb: 1.5,
        }}
      >
        <Paper
          elevation={0}
          sx={{ p: 1.25, border: '1px solid ' + border, background: glass }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1 }}>
            <FolderOutlinedIcon color="primary" />
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Projects · 作業部屋
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
                  <Chip
                    size="small"
                    variant="outlined"
                    label={(project.repositories || []).length + ' repos'}
                    sx={{ height: 20, fontSize: '0.58rem' }}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={(project.mcpTools || []).length + ' MCP'}
                    sx={{ height: 20, fontSize: '0.58rem' }}
                  />
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
              <InputLabel>担当</InputLabel>
              <Select
                label="担当"
                value={draft.executionMode}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  executionMode: event.target.value,
                }))}
              >
                <MenuItem value="agent">Agent</MenuItem>
                <MenuItem value="human">Human</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>長期テーマ（Space）</InputLabel>
              <Select
                label="長期テーマ（Space）"
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
