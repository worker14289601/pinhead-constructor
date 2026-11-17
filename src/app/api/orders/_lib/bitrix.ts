import { orderText, type Order } from './parse';

/** COMMENTS сделки — HTML: текст клиента экранируем, переносы строк ставим сами. */
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Заявка в Битрикс24 через входящий вебхук (права: CRM).
 * Создаётся контакт и сделка; файлы прикладываются комментариями в ленту сделки — по одному на файл,
 * чтобы один большой файл не уронил остальные.
 *
 * @param webhook  адрес вебхука вида https://<портал>.bitrix24.ru/rest/<id>/<ключ>/
 * @param categoryId  id воронки сделок; пусто — воронка по умолчанию
 * @returns имена недоставленных файлов; бросает ошибку, если не создалась сделка.
 */
export async function sendToBitrix(o: Order, webhook: string, categoryId?: string): Promise<string[]> {
  const base = webhook.replace(/\/+$/, '');
  const call = async <T>(method: string, body: unknown): Promise<T> => {
    const r = await fetch(`${base}/${method}.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await r.json().catch(() => ({}))) as { result?: T; error?: string; error_description?: string };
    if (!r.ok || json.error || json.result === undefined) {
      throw new Error(`bitrix ${method}: ${json.error_description || json.error || r.status}`);
    }
    return json.result;
  };

  // Источник сделки: код из справочника «Источники» CRM (например, свой источник «Конструктор»).
  const sourceId = process.env.ORDER_BITRIX_SOURCE_ID?.trim();
  // Своё поле сделки (UF_CRM_…) — в него пишется «Конструктор», если источник занят под другое.
  const markField = /^UF_CRM_\w+$/.test(process.env.ORDER_BITRIX_MARK_FIELD ?? '') ? process.env.ORDER_BITRIX_MARK_FIELD : undefined;

  const c = o.contacts;
  // Контакт — не обязательное условие: если не создался, сделка всё равно уйдёт с контактами в тексте.
  let contactId: number | undefined;
  try {
    contactId = await call<number>('crm.contact.add', {
      fields: {
        NAME: c.name,
        OPENED: 'Y',
        PHONE: [{ VALUE: c.phone, VALUE_TYPE: 'WORK' }],
        EMAIL: [{ VALUE: c.email, VALUE_TYPE: 'WORK' }],
        ADDRESS_CITY: c.city,
        ADDRESS: c.address,
        ...(sourceId ? { SOURCE_ID: sourceId } : {}),
      },
    });
  } catch (e) {
    console.error('[order]', o.number, e);
  }

  const dealId = await call<number>('crm.deal.add', {
    fields: {
      TITLE: `Конструктор № ${o.number}: ${o.garment.name}, ${o.qty} шт${o.lines.length > 1 ? `, ${o.lines.length} цв.` : ''}`,
      ...(categoryId ? { CATEGORY_ID: Number(categoryId) } : {}),
      ...(contactId ? { CONTACT_ID: contactId } : {}),
      OPENED: 'Y',
      OPPORTUNITY: o.total,
      CURRENCY_ID: 'RUB',
      COMMENTS: escapeHtml(orderText(o)).replace(/\n/g, '<br>'),
      // Метка источника: по ней заявки конструктора отбираются фильтром и в отчётах CRM.
      ...(sourceId ? { SOURCE_ID: sourceId } : {}),
      SOURCE_DESCRIPTION: `Конструктор${o.page ? ` · ${o.page}` : ''}`,
      ...(markField ? { [markField]: 'Конструктор' } : {}),
      UTM_SOURCE: o.utm.source,
      UTM_MEDIUM: o.utm.medium,
      UTM_CAMPAIGN: o.utm.campaign,
      UTM_CONTENT: o.utm.content,
      UTM_TERM: o.utm.term,
    },
    params: { REGISTER_SONET_EVENT: 'Y' },
  });

  const failed: string[] = [];
  for (const f of o.files) {
    try {
      const base64 = Buffer.from(await f.file.arrayBuffer()).toString('base64');
      await call('crm.timeline.comment.add', {
        fields: { ENTITY_ID: dealId, ENTITY_TYPE: 'deal', COMMENT: f.title, FILES: [[f.name, base64]] },
      });
    } catch (e) {
      console.error('[order]', o.number, e);
      failed.push(f.name);
    }
  }
  if (failed.length) {
    await call('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: dealId, ENTITY_TYPE: 'deal',
        COMMENT: `⚠️ Не удалось приложить файлы: ${failed.join(', ')}. Запросите макет у клиента.`,
      },
    }).catch(() => undefined);
  }
  return failed;
}
