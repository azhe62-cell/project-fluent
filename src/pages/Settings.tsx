import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Dialog, Field, Notice, PageHeader } from '@/components/ui/ui';
import { useAuth } from '@/lib/auth-context';
import { useServices } from '@/lib/services-context';
import { useDocumentTitle } from '@/lib/hooks';

export default function Settings() {
  useDocumentTitle('Settings');
  const { user } = useAuth(); const { auth, mode } = useServices(); const navigate = useNavigate();
  const [name, setName] = useState(user?.displayName ?? ''); const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false); const [typed, setTyped] = useState(''); const [deleting, setDeleting] = useState(false);

  const save = async () => {
    const n = name.trim(); if (n.length < 2 || n.length > 60) { setMsg({ tone: 'bad', text: 'Display name must be 2–60 characters.' }); return; }
    setBusy(true); setMsg(null);
    try { await auth.updateDisplayName(n); setMsg({ tone: 'ok', text: 'Saved.' }); } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Could not save.' }); } finally { setBusy(false); }
  };
  const del = async () => {
    setDeleting(true);
    try { await auth.deleteAccount(); navigate('/', { replace: true }); } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Could not delete the account.' }); setConfirm(false); setDeleting(false); }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Settings" title="Your account" />
      <Card className="p-6">
        <h2 className="text-xl font-semibold">Profile</h2>
        <div className="mt-4 space-y-4">
          <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Field label="Email" value={user?.email ?? ''} readOnly hint="Email changes aren’t supported yet." />
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button onClick={save} loading={busy}>Save changes</Button>
        </div>
        <p className="mt-5 text-xs text-muted">Target exam and study-goal preferences are planned but not built yet.</p>
      </Card>
      <Card className="mt-5 p-6">
        <h2 className="text-xl font-semibold">Data &amp; privacy</h2>
        <p className="mt-2 text-sm text-muted">{mode === 'local' ? 'You’re in local demo mode: everything lives in this browser’s storage and nothing is sent to a server.' : 'Your attempts, answers, results, Mistake Vault and practice history are stored privately against your account.'}</p>
      </Card>
      <Card className="mt-5 border-bad/30 p-6">
        <h2 className="text-xl font-semibold text-bad">Delete account</h2>
        <p className="mt-2 text-sm text-muted">Permanently removes your account and all learning data (attempts, answers, results, vault, practice history). This can’t be undone.</p>
        <Button variant="danger" className="mt-4" onClick={() => setConfirm(true)}>Delete my account…</Button>
      </Card>
      <Dialog open={confirm} onClose={() => !deleting && setConfirm(false)} title="Delete your account?"
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)} disabled={deleting}>Cancel</Button><Button variant="danger" disabled={typed !== 'DELETE'} loading={deleting} onClick={del}>Delete permanently</Button></>}>
        <p>This permanently deletes all your data. Type <b className="font-mono">DELETE</b> to confirm.</p>
        <Field className="mt-4" label="Confirmation" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Dialog>
    </div>
  );
}
