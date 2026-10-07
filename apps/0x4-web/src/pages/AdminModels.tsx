// Admin: agent model configuration.
// Protected by ADMIN_SECRET (entered once, stored in sessionStorage).
// Lets the admin switch default models for the whole agent system at runtime.
import { useEffect, useState } from 'react';
import Button from '@/components/Button';

interface AgentConfig {
  defaultChatModel: string;
  defaultImageModel: string;
  defaultVideoModel: string;
  defaultTtsModel: string;
  defaultTtsVoice: string;
  priceMarkup: number;
  hiddenModels: string[];
}

interface ModelInfo {
  id: string;
  label: string;
  group: string;
}

const FIELDS: Array<{ key: keyof AgentConfig; label: string; hint: string }> = [
  { key: 'defaultChatModel', label: '对话模型', hint: 'agent 默认用的 LLM' },
  { key: 'defaultImageModel', label: '画图模型', hint: 'generate_image 默认模型' },
  { key: 'defaultVideoModel', label: '视频模型', hint: 'generate_video 默认模型' },
  { key: 'defaultTtsModel', label: '语音模型', hint: 'TTS 默认模型' },
];

export default function AdminModels() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem('admin-secret') || '');
  const [authed, setAuthed] = useState(false);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async (s: string) => {
    setError('');
    try {
      const [cfgRes, modelsRes] = await Promise.all([
        fetch('/api/admin/config', { headers: { 'x-admin-secret': s } }),
        fetch('/api/models'),
      ]);
      if (cfgRes.status === 401) {
        setError('密钥不对');
        setAuthed(false);
        return;
      }
      if (!cfgRes.ok) throw new Error(`config: ${cfgRes.status}`);
      const cfg = await cfgRes.json();
      setConfig(cfg.config);
      const md = await modelsRes.json();
      if (Array.isArray(md.models)) setModels(md.models);
      setAuthed(true);
      sessionStorage.setItem('admin-secret', s);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  };

  useEffect(() => {
    if (secret) void load(secret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      setConfig(data.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const modelsFor = (group: string) => models.filter((m) => m.group === group);

  if (!authed) {
    return (
      <div className="mx-auto max-w-md p-8">
        <h1 className="mb-4 text-xl font-bold">Agent 后台</h1>
        <p className="mb-3 text-sm text-muted">输入 ADMIN_SECRET 进入</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(secret)}
            placeholder="admin secret"
            className="min-w-0 flex-1 rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-primary/30 focus:ring-2"
          />
          <Button size="sm" onClick={() => void load(secret)}>
            进入
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-down">{error}</p>}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <p className="text-muted">加载中…</p>
        {error && <p className="mt-2 text-sm text-down">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Agent 模型配置</h1>
        <span className="rounded-full bg-up/10 px-3 py-1 text-xs text-up">实时生效</span>
      </div>

      {FIELDS.map(({ key, label, hint }) => {
        const group = key === 'defaultImageModel' ? 'image' : key === 'defaultVideoModel' ? 'video' : 'chat';
        const options = modelsFor(group);
        return (
          <div key={key} className="rounded-2xl bg-card p-4">
            <div className="mb-1 font-semibold">{label}</div>
            <div className="mb-2 text-xs text-muted">{hint}</div>
            {options.length > 0 ? (
              <select
                value={config[key] as string}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                className="w-full rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-primary/30 focus:ring-2"
              >
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={config[key] as string}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                className="w-full rounded-xl bg-background px-3 py-2.5 font-mono text-sm outline-none ring-primary/30 focus:ring-2"
              />
            )}
            <div className="mt-1 font-mono text-[11px] text-muted">当前: {config[key] as string}</div>
          </div>
        );
      })}

      <div className="rounded-2xl bg-card p-4">
        <div className="mb-1 font-semibold">TTS 音色</div>
        <div className="mb-2 text-xs text-muted">默认语音（Cherry / Ethan 等）</div>
        <input
          value={config.defaultTtsVoice}
          onChange={(e) => setConfig({ ...config, defaultTtsVoice: e.target.value })}
          className="w-full rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-primary/30 focus:ring-2"
        />
      </div>

      <div className="rounded-2xl bg-card p-4">
        <div className="mb-1 font-semibold">加价倍数</div>
        <div className="mb-2 text-xs text-muted">成本 × 倍数 = 卖给用户的价格（1.5 = 赚 50%）</div>
        <input
          type="number"
          min={1}
          max={100}
          step={0.1}
          value={config.priceMarkup}
          onChange={(e) => setConfig({ ...config, priceMarkup: parseFloat(e.target.value) || 1 })}
          className="w-full rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-primary/30 focus:ring-2"
        />
      </div>

      {error && <p className="text-sm text-down">{error}</p>}

      <div className="flex gap-2">
        <Button className="flex-1" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : saved ? '已保存 ✓' : '保存配置'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            sessionStorage.removeItem('admin-secret');
            setAuthed(false);
            setSecret('');
          }}
        >
          退出
        </Button>
      </div>

      <p className="text-xs text-muted">
        修改立即生效，无需重新部署。serverless 冷启动后会回到环境变量默认值。
      </p>
    </div>
  );
}
