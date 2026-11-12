'use client';
import type { Draft } from '../model/draft';
import s from './constructor.module.css';

/** Вопрос при открытии, если от прошлого раза остался черновик. */
export function DraftPrompt({ draft, onNew, onContinue }: { draft: Draft; onNew: () => void; onContinue: () => void }) {
  const when = new Date(draft.savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return (
    <div className={s.modalBg}>
      <div className={s.modal} role="dialog" aria-label="Продолжить дизайн?">
        <h3>Продолжить дизайн?</h3>
        <p className={s.muted}>Мы сохранили ваш дизайн в этом браузере ({when}).</p>
        {draft.imagesDropped && <p className={s.warn}>Картинки в черновик не поместились — их нужно загрузить заново.</p>}
        <button className={s.cta} onClick={onContinue}>Продолжить</button>
        <button className={s.btn} onClick={onNew}>Начать новый</button>
      </div>
    </div>
  );
}
