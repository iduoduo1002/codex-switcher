import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import './BulkImportModal.css';

interface ImportSummary {
    format: string;
    parsed: number;
    errors: string[];
}

interface BulkParsedAccountInfo {
    email: string;
    plan_type: string | null;
    account_id: string | null;
    needs_refresh: boolean;
}

interface BulkImportResult {
    summaries: ImportSummary[];
    accounts: BulkParsedAccountInfo[];
    fatal: string[];
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

const FORMAT_LABEL: Record<string, string> = {
    cpa: 'cpa（codex_credentials）',
    sub2api: 'sub2api',
    cockpit: 'Cockpit',
    'four-segment-rt': '四段RT',
    native: 'codex-switcher',
};

function bytesToBase64(bytes: Uint8Array): string {
    // 大文件 chunk 处理，避免 spread 爆栈
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, i + CHUNK);
        binary += String.fromCharCode.apply(null, Array.from(slice));
    }
    return btoa(binary);
}

export function BulkImportModal({ isOpen, onClose, onSuccess }: Props) {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<BulkImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const pickAndImport = async () => {
        setError(null);
        setResult(null);
        const selection = await openDialog({
            multiple: true,
            filters: [
                { name: '账号导入文件', extensions: ['json', 'zip', 'txt'] },
                { name: '所有文件', extensions: ['*'] },
            ],
        });
        const paths: string[] = Array.isArray(selection)
            ? selection
            : selection
              ? [selection]
              : [];
        if (paths.length === 0) return;

        setBusy(true);
        try {
            const files = await Promise.all(
                paths.map(async (p) => {
                    const bytes = await readFile(p);
                    const filename = p.split('/').pop() || p;
                    return {
                        filename,
                        content_b64: bytesToBase64(bytes),
                    };
                })
            );
            const r = await invoke<BulkImportResult>('bulk_import_accounts', { files });
            setResult(r);
            onSuccess?.();
        } catch (e: any) {
            setError(`${e}`);
        } finally {
            setBusy(false);
        }
    };

    const totalAdded = result?.accounts.length ?? 0;
    const totalParsed = result?.summaries.reduce((s, x) => s + x.parsed, 0) ?? 0;
    const skipped = totalParsed - totalAdded;

    return (
        <div className="bulk-import-overlay" onClick={onClose}>
            <div className="bulk-import-modal" onClick={(e) => e.stopPropagation()}>
                <div className="bulk-import-header">
                    <h2>批量导入账号</h2>
                    <button className="bulk-import-close" onClick={onClose}>×</button>
                </div>

                <div className="bulk-import-body">
                    <div className="bulk-import-help">
                        自动识别以下格式，可一次选多个文件：
                        <ul>
                            <li><b>cpa</b>：codex_credentials zip / 单 .json</li>
                            <li><b>sub2api</b>：含 proxies + accounts 数组的导出</li>
                            <li><b>Cockpit</b>：tokens.* 风格的数组</li>
                            <li><b>四段RT</b>：每行 <code>email----xxx----xxx----rt_xxx</code></li>
                            <li><b>codex-switcher 原生</b>：本工具自己导出的 accounts.json</li>
                        </ul>
                        同邮箱已存在的账号会跳过（不覆盖现有 token，避免误伤）。
                    </div>

                    <div className="bulk-import-actions">
                        <button
                            className="btn btn-primary"
                            onClick={pickAndImport}
                            disabled={busy}
                        >
                            {busy ? '导入中…' : '选择文件并导入'}
                        </button>
                    </div>

                    {error && (
                        <div className="bulk-import-error">{error}</div>
                    )}

                    {result && (
                        <div className="bulk-import-result">
                            <div className="bulk-import-stats">
                                <span className="stat">解析 {totalParsed}</span>
                                <span className="stat ok">新增 {totalAdded}</span>
                                {skipped > 0 && <span className="stat skip">跳过 {skipped}（同名）</span>}
                                {result.fatal.length > 0 && (
                                    <span className="stat fail">失败 {result.fatal.length}</span>
                                )}
                            </div>

                            <div className="bulk-import-summary-list">
                                {result.summaries.map((s, i) => (
                                    <div key={i} className="bulk-import-summary-item">
                                        <span className="format-tag">{FORMAT_LABEL[s.format] || s.format}</span>
                                        <span>解析 {s.parsed} 个账号</span>
                                    </div>
                                ))}
                                {result.fatal.map((msg, i) => (
                                    <div key={`f-${i}`} className="bulk-import-fatal">
                                        ⚠️ {msg}
                                    </div>
                                ))}
                            </div>

                            {result.accounts.length > 0 && (
                                <details className="bulk-import-details">
                                    <summary>新增账号详情（{result.accounts.length}）</summary>
                                    <table className="bulk-import-table">
                                        <thead>
                                            <tr>
                                                <th>Email</th>
                                                <th>Plan</th>
                                                <th>状态</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.accounts.map((a, i) => (
                                                <tr key={i}>
                                                    <td>{a.email}</td>
                                                    <td>{a.plan_type || '—'}</td>
                                                    <td>
                                                        {a.needs_refresh ? (
                                                            <span className="needs-refresh">⚠ 仅 RT，首次请求自动 refresh</span>
                                                        ) : (
                                                            '✓ ready'
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </details>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
