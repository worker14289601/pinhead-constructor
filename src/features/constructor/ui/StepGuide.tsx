'use client';
import { Icon } from './icons';
import g from './guide.module.css';

export type GuideStep = 1 | 2 | 3;

const STEPS: Array<{ n: GuideStep; title: string; note: string }> = [
  { n: 1, title: 'Выберите вещь', note: 'Модель и цвет — в колонке слева' },
  { n: 2, title: 'Нанесите принт', note: 'Картинка, текст или готовый принт — справа' },
  { n: 3, title: 'Отправьте заявку', note: 'Размеры — справа, менеджер свяжется с вами' },
];

/**
 * Шаги над конструктором (десктоп). Пока посетитель ничего не сделал — крупный баннер с пояснениями;
 * после первого действия — тонкая полоса: пройденные шаги с галочкой, текущий выделен.
 * Баннер и полоса — два готовых слоя: при смене один плавно схлопывается и гаснет, другой проявляется,
 * поэтому раскладка внутри не перестраивается на ходу. Нажатие на шаг показывает, где он делается.
 */
export function StepGuide({ big, active, done, onStep }: {
  big: boolean;
  active: GuideStep;
  done: (n: GuideStep) => boolean;
  onStep: (n: GuideStep) => void;
}) {
  return (
    <nav className={g.guide} data-big={big ? '' : undefined} aria-label="Как заказать">
      <div className={g.layerBig} aria-hidden={!big}>
        <div className={g.layerInner}>
          <div className={g.banner}>
            <p className={g.title}>Свой принт за 3 шага</p>
            <ol className={g.cards}>
              {STEPS.map(({ n, title, note }) => (
                <li key={n} className={g.cardItem}>
                  <button
                    type="button" className={g.card} onClick={() => onStep(n)} tabIndex={big ? undefined : -1}
                    data-active={active === n ? '' : undefined}
                  >
                    <span className={g.cardNum}>{n}</span>
                    <span className={g.cardText}>
                      <span className={g.cardTitle}>{title}</span>
                      <span className={g.cardNote}>{note}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className={g.layerStrip} aria-hidden={big}>
        <div className={g.layerInner}>
          <ol className={g.strip}>
            {STEPS.map(({ n, title }, i) => {
              const isDone = done(n);
              return (
                <li key={n} className={g.item}>
                  {i > 0 && <span className={g.line} data-done={done(STEPS[i - 1].n) ? '' : undefined} aria-hidden />}
                  <button
                    type="button" className={g.step} onClick={() => onStep(n)} tabIndex={big ? -1 : undefined}
                    aria-current={active === n ? 'step' : undefined}
                    data-active={active === n ? '' : undefined} data-done={isDone ? '' : undefined}
                  >
                    <span className={g.num}>{isDone ? <Icon name="checkMark" size={16} /> : n}</span>
                    <span className={g.stepTitle}>{title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </nav>
  );
}
