import { createCloseup, createCryptHall } from './render.js';
import { t, errorText, getLang } from './i18n.js';

const TIERS = [1, 2, 3, 4];
const GRAB_RADIUS = 6;

// The grave window: anyone can look, the owner (with the code) also gets the tools.
export function createGraveDialog({ api, el, clear, startPayment, getConfig, getState, onClose }) {
  const dialog = document.getElementById('grave-dialog');
  const body = document.getElementById('grave-body');
  let closeup = null;
  let plotIndex = null;
  let myCode = null;
  let draft = null;
  let dirty = false;
  let tool = null;
  let mode = 'grave';

  // Turn and zoom controls shared by the viewer and the owner's editor.
  function viewControls() {
    const zoomButton = el('button', { type: 'button', className: 'ghost', textContent: t('zoomIn') });
    zoomButton.addEventListener('click', () => {
      zoomButton.textContent = closeup.toggleZoom() === 1 ? t('zoomIn') : t('zoomOut');
    });
    return el('div', { className: 'view-controls' },
      el('button', { type: 'button', className: 'ghost', textContent: `⟲ ${t('turnLeft')}`, on: { click: () => closeup.turn(-1) } }),
      el('button', { type: 'button', className: 'ghost', textContent: `${t('turnRight')} ⟳`, on: { click: () => closeup.turn(1) } }),
      zoomButton);
  }

  // Dragging sideways on the picture turns the grave.
  function dragToTurn(canvas) {
    let startX = null;
    canvas.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (startX === null || Math.abs(event.clientX - startX) < 60) return;
      closeup.turn(event.clientX > startX ? 1 : -1);
      startX = event.clientX;
    });
    const end = () => { startX = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function stopCloseup() {
    closeup?.stop();
    closeup = null;
  }

  function open() {
    if (!dialog.open) dialog.showModal();
  }

  function publicPlot(index) {
    return getState().plots[index];
  }

  function draftPlot(grave) {
    return {
      plot: grave.plot,
      center: publicPlot(grave.plot).center,
      occupied: true,
      grave: { ...grave, ...draft },
    };
  }

  function hallContent(name, body, color, items) {
    return { title: name, body, color: color === 'stone' ? 'marble' : color, items };
  }

  // The door is the first thing a visitor sees; opening it reveals the hall behind.
  function cryptStage(canvas, doorName, startOpen) {
    const door = el('div', { className: startOpen ? 'crypt-door open' : 'crypt-door' },
      el('div', { className: 'leaf left' }),
      el('div', { className: 'leaf right' }),
      el('div', { className: 'door-front' },
        el('p', { className: 'door-name', textContent: doorName }),
        el('button', {
          type: 'button',
          textContent: t('cryptOpen'),
          on: { click: () => door.classList.add('open') },
        })));
    return el('div', { className: 'crypt-stage' }, canvas, door);
  }

  function showCrypt(zoneId) {
    stopCloseup();
    mode = 'crypt';
    myCode = null;
    const state = getState();
    const zone = state.ads.find((item) => item.id === zoneId);
    const anchor = zone.row * state.grid.cols + zone.col;
    plotIndex = anchor;
    const plot = publicPlot(anchor);
    const canvas = el('canvas', { className: 'hall' });
    const error = el('p', { className: 'error', role: 'alert' });
    const parts = [];

    if (plot.grave) {
      parts.push(
        plot.grave.epitaph ? el('p', { className: 'epitaph', textContent: `« ${plot.grave.epitaph} »` }) : null,
        plot.grave.link ? el('p', {}, el('a', { href: plot.grave.link, target: '_blank', rel: 'sponsored noopener', textContent: t('cryptLink') })) : null,
      );
      const codeInput = el('input', { autocomplete: 'off', spellcheck: false, placeholder: t('codePlaceholder') });
      parts.push(el('form', {
        className: 'owner-login',
        on: {
          submit: (event) => {
            event.preventDefault();
            login(codeInput.value).catch((err) => { error.textContent = errorText(err.code); });
          },
        },
      }, el('label', { textContent: t('cryptOwnerPrompt') }), el('div', { className: 'row' }, codeInput, el('button', { type: 'submit', textContent: t('enter') }))));
      parts.push(el('button', { type: 'button', className: 'link', textContent: t('report'), on: { click: () => showReport(anchor) } }));
    } else if (plot.taken && plot.occupied) {
      parts.push(el('p', { textContent: t('plotPending') }));
    } else if (!getConfig().cryptsOpen || !getConfig().ordersOpen) {
      parts.push(el('p', { className: 'beta-note', textContent: t('cryptBetaText') }));
    } else {
      const config = getConfig();
      const name = el('input', { maxLength: 24, required: true, autocomplete: 'off' });
      const buyer = config.manualPayments ? el('input', { maxLength: 60, required: true, autocomplete: 'off' }) : null;
      const consent = el('input', { type: 'checkbox' });
      parts.push(
        el('p', { textContent: t('cryptFreeText') }),
        el('p', { className: 'level-price', textContent: t('tierPrice', { price: config.products.tier_5.price }) }),
        el('form', {
          on: {
            submit: async (event) => {
              event.preventDefault();
              try {
                const order = await api('/api/orders/crypt', { zone: zoneId, name: name.value, consent: consent.checked, buyerRef: buyer?.value });
                dialog.close();
                startPayment(order);
              } catch (err) {
                error.textContent = errorText(err.code);
              }
            },
          },
        },
          el('div', { className: 'field' }, el('label', { textContent: t('cryptNameLabel') }), name),
          buyer ? el('div', { className: 'field' }, el('label', { textContent: t('buyerLabel') }), buyer) : null,
          el('label', { className: 'check' }, consent, el('span', { textContent: t('consent') })),
          el('p', { className: 'small', textContent: t('priceNote', { price: config.products.tier_5.price }) }),
          el('button', { type: 'submit', textContent: t('cryptRent') })),
      );
    }

    const cryptsForRent = getConfig().cryptsOpen && getConfig().ordersOpen;
    const title = plot.grave?.name ?? (cryptsForRent ? t('cryptFreeTitle') : t('cryptBetaTitle'));
    clear(body, el('h2', { textContent: t('cryptHeading') }), cryptStage(canvas, title, false), ...parts, error);
    closeup = createCryptHall(canvas);
    closeup.set(hallContent(title, plot.grave ? plot.grave.epitaph ?? '' : cryptsForRent ? t('cryptFreeBody') : t('cryptBetaBody'), plot.grave?.color ?? 'marble', plot.grave?.items ?? []));
    open();
  }

  function renderCryptOwner(grave) {
    stopCloseup();
    mode = 'crypt';
    const config = getConfig();
    draft ??= { color: grave.color, items: grave.items.map((item) => ({ ...item })) };
    const error = el('p', { className: 'error', role: 'alert' });
    const canvas = el('canvas', { className: 'hall editable' });
    const limit = config.itemLimits[grave.tier];
    const counter = el('p', { className: 'small' });
    const saveButton = el('button', { type: 'button', textContent: t('saveGrave'), disabled: true });
    const canEdit = !grave.lapsed;
    const banner = () => hallContent(grave.ownName, grave.epitaphPending ?? grave.ownEpitaph ?? '', draft.color, draft.items);
    const touched = () => {
      dirty = true;
      saveButton.disabled = false;
      counter.textContent = t('itemsLeft', { used: draft.items.length, limit });
      closeup?.set(banner());
    };
    counter.textContent = t('itemsLeft', { used: draft.items.length, limit });
    const run = async (fn) => {
      try {
        error.textContent = '';
        await fn();
      } catch (err) {
        error.textContent = errorText(err.code);
      }
    };

    const themes = el('div', { className: 'options' }, ...['marble', 'obsidian', 'gold', 'rose', 'neon', 'ice'].map((option) => el('button', {
      type: 'button',
      className: option === draft.color ? '' : 'ghost',
      disabled: !canEdit,
      textContent: t(`color_${option}`),
      on: {
        click: (event) => {
          draft.color = option;
          for (const button of themes.children) button.className = 'ghost';
          event.target.className = '';
          touched();
        },
      },
    })));

    const tools = el('div', { className: 'options' });
    const pick = (next, button) => {
      tool = tool === next ? null : next;
      for (const other of tools.children) other.className = 'ghost';
      if (tool) button.className = '';
    };
    for (const item of Object.keys(config.items)) {
      tools.append(el('button', { type: 'button', className: 'ghost', disabled: !canEdit, textContent: t(`item_${item}`), on: { click: (event) => pick(item, event.target) } }));
    }
    tools.append(el('button', { type: 'button', className: 'ghost', disabled: !canEdit, textContent: t('toolErase'), on: { click: (event) => pick('erase', event.target) } }));

    let dragging = null;
    const nearest = (x, y) => draft.items.find((item) => Math.hypot(item.x - x, item.y - y) < GRAB_RADIUS) ?? null;
    canvas.addEventListener('pointerdown', (event) => {
      if (!canEdit) return;
      const point = closeup.toFloor(event.clientX, event.clientY);
      const hit = nearest(point.x, point.y);
      if (tool === 'erase') {
        if (hit) {
          draft.items = draft.items.filter((item) => item !== hit);
          touched();
        }
      } else if (hit && !tool) {
        dragging = hit;
        canvas.setPointerCapture(event.pointerId);
      } else if (tool && point.inside) {
        if (draft.items.length >= limit) {
          error.textContent = t('itemsFull');
          return;
        }
        draft.items.push({ type: tool, x: point.x, y: point.y });
        touched();
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const point = closeup.toFloor(event.clientX, event.clientY);
      if (point.inside) {
        dragging.x = point.x;
        dragging.y = point.y;
        touched();
      }
    });
    const endDrag = () => { dragging = null; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    saveButton.addEventListener('click', () => run(async () => {
      await api('/api/grave/customize', { code: myCode, color: draft.color, items: draft.items });
      await reloadOwner();
    }));

    const bannerInput = el('input', { maxLength: 40, value: grave.epitaphPending ?? grave.ownEpitaph ?? '', disabled: !canEdit });
    const linkInput = el('input', { type: 'url', maxLength: 200, placeholder: 'https://', value: grave.linkPending ?? grave.ownLink ?? '', disabled: !canEdit });
    clear(body,
      el('h2', { textContent: `${t('cryptHeading')}: ${grave.ownName}` }),
      el('div', { className: 'grave-layout' },
        el('div', {},
          cryptStage(canvas, grave.ownName, true),
          el('p', { className: 'small', textContent: t(`status_${grave.status}`) }),
          grave.lapsed
            ? el('p', { className: 'error', textContent: t('lapsedNote', { date: new Date(grave.releaseAt).toLocaleDateString(getLang()) }) })
            : el('p', { className: 'small', textContent: t('subscriptionUntil', { date: new Date(grave.paidUntil).toLocaleDateString(getLang()) }) })),
        el('div', {},
          el('h3', { textContent: t('tools') }),
          el('p', { className: 'small', textContent: t('toolHint') }),
          tools,
          counter,
          el('p', { className: 'small', textContent: t('cryptTheme') }),
          themes,
          el('div', { className: 'actions' }, saveButton),
          el('h3', { textContent: t('cryptBanner') }),
          el('p', { className: 'small', textContent: t('cryptBannerNote') }),
          bannerInput,
          el('p', { className: 'small', textContent: t('cryptLinkLabel') }),
          linkInput,
          (grave.epitaphPending || grave.linkPending) ? el('p', { className: 'small', textContent: t('cryptPending') }) : null,
          el('div', { className: 'actions' }, el('button', {
            type: 'button',
            className: 'ghost',
            disabled: !canEdit,
            textContent: t('epitaphSave'),
            on: {
              click: () => run(async () => {
                await api('/api/grave/customize', { code: myCode, epitaph: bannerInput.value, link: linkInput.value });
                await reloadOwner();
              }),
            },
          })))),
      error,
      el('button', {
        type: 'button',
        className: 'link',
        textContent: t('logout'),
        on: {
          click: () => {
            myCode = null;
            dialog.close();
          },
        },
      }));
    closeup = createCryptHall(canvas);
    closeup.set(banner());
  }

  function renderAny(grave) {
    if (grave.crypt) renderCryptOwner(grave);
    else {
      mode = 'grave';
      renderOwner(grave);
    }
  }

  function showViewer(index) {
    stopCloseup();
    mode = 'grave';
    plotIndex = index;
    myCode = null;
    const plot = publicPlot(index);
    const canvas = el('canvas', { className: 'closeup' });
    const codeInput = el('input', { autocomplete: 'off', spellcheck: false, placeholder: t('codePlaceholder') });
    const error = el('p', { className: 'error', role: 'alert' });
    clear(body,
      el('h2', { textContent: plot.grave.name }),
      canvas,
      viewControls(),
      plot.grave.epitaph ? el('p', { className: 'epitaph', textContent: `« ${plot.grave.epitaph} »` }) : null,
      el('p', { className: 'small', textContent: `${t(`stage${plot.grave.stage}`)} · ${t('plotNumber', { n: index + 1 })}` }),
      !getConfig().ordersOpen ? null : el('form', {
        className: 'owner-login',
        on: {
          submit: (event) => {
            event.preventDefault();
            login(codeInput.value).catch((err) => { error.textContent = errorText(err.code); });
          },
        },
      },
        el('label', { textContent: t('ownerPrompt') }),
        el('div', { className: 'row' }, codeInput, el('button', { type: 'submit', textContent: t('enter') }))),
      error,
      el('button', { type: 'button', className: 'link', textContent: t('report'), on: { click: () => showReport(index) } }));
    closeup = createCloseup(canvas);
    closeup.set(plot);
    dragToTurn(canvas);
    open();
  }

  function showReport(index) {
    stopCloseup();
    const reason = el('textarea', { rows: 4, maxLength: 500, placeholder: t('reportReason'), required: true });
    const error = el('p', { className: 'error', role: 'alert' });
    clear(body,
      el('h2', { textContent: t('report') }),
      el('form', {
        on: {
          submit: async (event) => {
            event.preventDefault();
            try {
              await api('/api/report', { plot: index, reason: reason.value });
              clear(body, el('p', { textContent: t('reportDone') }));
            } catch (err) {
              error.textContent = errorText(err.code);
            }
          },
        },
      }, reason, error, el('button', { type: 'submit', textContent: t('reportSend') })));
  }

  async function login(code) {
    const grave = await api('/api/grave', { code });
    myCode = code;
    plotIndex = grave.plot;
    draft = null;
    dirty = false;
    tool = null;
    renderAny(grave);
    open();
    return grave;
  }

  async function reloadOwner() {
    const grave = await api('/api/grave', { code: myCode });
    draft = null;
    dirty = false;
    renderAny(grave);
  }

  function renderOwner(grave) {
    stopCloseup();
    const config = getConfig();
    draft ??= { color: grave.color, style: grave.style, fence: grave.fence, items: grave.items.map((item) => ({ ...item })) };
    const error = el('p', { className: 'error', role: 'alert' });
    const canvas = el('canvas', { className: 'closeup editable' });
    const limit = config.itemLimits[grave.tier];
    const counter = el('p', { className: 'small' });
    const saveButton = el('button', { type: 'button', textContent: t('saveGrave'), disabled: true });
    const canEdit = !grave.lapsed;

    const redraw = () => closeup?.set(draftPlot(grave));
    const touched = () => {
      dirty = true;
      saveButton.disabled = false;
      counter.textContent = t('itemsLeft', { used: draft.items.length, limit });
      redraw();
    };
    counter.textContent = t('itemsLeft', { used: draft.items.length, limit });

    const run = async (fn) => {
      try {
        error.textContent = '';
        await fn();
      } catch (err) {
        error.textContent = errorText(err.code);
      }
    };

    const choiceRow = (table, prefix, current, onPick) => {
      const row = el('div', { className: 'options' });
      for (const [option, minTier] of Object.entries(table)) {
        const locked = minTier > grave.tier;
        row.append(el('button', {
          type: 'button',
          className: option === current ? '' : 'ghost',
          disabled: locked || !canEdit,
          textContent: locked ? `${t(`${prefix}_${option}`)} · ${t('locked', { tier: minTier })}` : t(`${prefix}_${option}`),
          on: {
            click: (event) => {
              onPick(option);
              for (const button of row.children) button.className = 'ghost';
              event.target.className = '';
            },
          },
        }));
      }
      return row;
    };

    const toolHint = el('p', { className: 'small', textContent: t('toolHint') });
    const itemTools = el('div', { className: 'options' });
    const selectTool = (next, button) => {
      tool = tool === next ? null : next;
      for (const other of itemTools.children) other.className = 'ghost';
      if (tool) button.className = '';
    };
    for (const [item, minTier] of Object.entries(config.items)) {
      const locked = minTier > grave.tier;
      itemTools.append(el('button', {
        type: 'button',
        className: 'ghost',
        disabled: locked || !canEdit,
        textContent: locked ? `${t(`item_${item}`)} · ${t('locked', { tier: minTier })}` : t(`item_${item}`),
        on: { click: (event) => selectTool(item, event.target) },
      }));
    }
    itemTools.append(el('button', {
      type: 'button',
      className: 'ghost',
      disabled: !canEdit,
      textContent: t('toolErase'),
      on: { click: (event) => selectTool('erase', event.target) },
    }));

    const fenceToggle = el('input', { type: 'checkbox', checked: !!draft.fence, disabled: grave.tier < config.fenceTier || !canEdit });
    fenceToggle.addEventListener('change', () => {
      draft.fence = fenceToggle.checked;
      touched();
    });

    let dragging = null;
    const nearest = (x, y) => {
      let best = null;
      let bestDistance = GRAB_RADIUS;
      for (const item of draft.items) {
        const distance = Math.hypot(item.x - x, item.y - y);
        if (distance < bestDistance) {
          best = item;
          bestDistance = distance;
        }
      }
      return best;
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (!canEdit) return;
      const point = closeup.toGround(event.clientX, event.clientY);
      const hit = nearest(point.x, point.y);
      if (tool === 'erase') {
        if (hit) {
          draft.items = draft.items.filter((item) => item !== hit);
          touched();
        }
        return;
      }
      if (hit && !tool) {
        dragging = hit;
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      if (tool) {
        if (!point.inside) return;
        if (draft.items.length >= limit) {
          error.textContent = t('itemsFull');
          return;
        }
        draft.items.push({ type: tool, x: point.x, y: point.y });
        touched();
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const point = closeup.toGround(event.clientX, event.clientY);
      if (point.inside) {
        dragging.x = point.x;
        dragging.y = point.y;
        touched();
      }
    });
    const endDrag = () => { dragging = null; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    saveButton.addEventListener('click', () => run(async () => {
      await api('/api/grave/customize', { code: myCode, color: draft.color, style: draft.style, fence: draft.fence, items: draft.items });
      await reloadOwner();
    }));

    const epitaph = el('input', { maxLength: 40, value: grave.epitaphPending ?? grave.epitaph ?? '', disabled: !canEdit || grave.tier < config.epitaphTier });
    const care = el('div', { className: 'actions' }, ...['clean', 'wash', 'tidy'].map((action) => el('button', {
      type: 'button',
      textContent: t(`care_${action}`),
      disabled: grave.careReadyIn > 0 || grave.lapsed,
      on: {
        click: () => run(async () => {
          await api('/api/grave/care', { code: myCode, action });
          await reloadOwner();
        }),
      },
    })));

    let rename = null;
    if (grave.status === 'rejected') {
      const input = el('input', { maxLength: 24, value: grave.ownName });
      rename = el('form', {
        className: 'field',
        on: {
          submit: (event) => {
            event.preventDefault();
            run(async () => {
              await api('/api/grave/rename', { code: myCode, name: input.value });
              await reloadOwner();
            });
          },
        },
      }, input, el('button', { type: 'submit', textContent: t('rename') }));
    }

    const buyerRef = config.manualPayments ? el('input', { maxLength: 60, autocomplete: 'off', placeholder: t('buyerLabel') }) : null;
    const levels = TIERS.map((tier) => el('div', { className: 'upgrade' },
      el('span', { textContent: `${t(`tier${tier}`)} · ${t('tierPrice', { price: config.products[`tier_${tier}`].price })}` }),
      tier <= grave.tier
        ? el('span', { className: 'small', textContent: tier === grave.tier ? t('owned') : '' })
        : el('button', {
          type: 'button',
          className: 'ghost',
          textContent: t('upgradeTo'),
          on: {
            click: () => run(async () => {
              const order = await api('/api/orders/upgrade', { code: myCode, tier, buyerRef: buyerRef?.value });
              dialog.close();
              startPayment(order);
            }),
          },
        })));

    clear(body,
      el('h2', { textContent: `${t('yourGrave')}: ${grave.ownName}` }),
      el('div', { className: 'grave-layout' },
        el('div', {},
          canvas,
          viewControls(),
          grave.epitaph ? el('p', { className: 'epitaph', textContent: `« ${grave.epitaph} »` }) : null,
          el('p', { textContent: t(`stage${grave.stage}`) }),
          el('p', { className: 'small', textContent: t(`status_${grave.status}`) }),
          grave.lapsed
            ? el('p', { className: 'error', textContent: t('lapsedNote', { date: new Date(grave.releaseAt).toLocaleDateString(getLang()) }) })
            : el('p', { className: 'small', textContent: t('subscriptionUntil', { date: new Date(grave.paidUntil).toLocaleDateString(getLang()) }) }),
          rename,
          el('h3', { textContent: t('care') }),
          care,
          el('p', { className: 'small', textContent: t('careNote') })),
        el('div', {},
          el('h3', { textContent: t('tools') }),
          toolHint,
          itemTools,
          counter,
          el('p', { className: 'small', textContent: t('colorLabel') }),
          choiceRow(config.colors, 'color', draft.color, (option) => { draft.color = option; touched(); }),
          el('p', { className: 'small', textContent: t('styleLabel') }),
          choiceRow(config.styles, 'style', draft.style, (option) => { draft.style = option; touched(); }),
          el('label', { className: 'check' }, fenceToggle, el('span', {
            textContent: grave.tier < config.fenceTier ? `${t('fenceLabel')} · ${t('locked', { tier: config.fenceTier })}` : t('fenceLabel'),
          })),
          el('div', { className: 'actions' }, saveButton),
          el('p', { className: 'small', textContent: grave.tier < config.epitaphTier ? `${t('epitaphLabel')} · ${t('locked', { tier: config.epitaphTier })}` : t('epitaphLabel') }),
          grave.epitaphPending ? el('p', { className: 'small', textContent: t('epitaphPending', { text: grave.epitaphPending }) }) : null,
          epitaph,
          el('div', { className: 'actions' }, el('button', {
            type: 'button',
            className: 'ghost',
            disabled: !canEdit || grave.tier < config.epitaphTier,
            textContent: t('epitaphSave'),
            on: {
              click: () => run(async () => {
                await api('/api/grave/customize', { code: myCode, epitaph: epitaph.value });
                await reloadOwner();
              }),
            },
          })),
          el('h3', { textContent: t('upgrades') }),
          buyerRef,
          ...levels)),
      error,
      el('button', {
        type: 'button',
        className: 'link',
        textContent: t('logout'),
        on: {
          click: () => {
            myCode = null;
            dialog.close();
          },
        },
      }));

    closeup = createCloseup(canvas);
    redraw();
    if (grave.careReadyIn > 0) {
      setTimeout(() => {
        if (dialog.open && myCode && !dirty) reloadOwner().catch(() => {});
      }, grave.careReadyIn + 200);
    }
  }

  document.getElementById('grave-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stopCloseup();
    dirty = false;
    tool = null;
    onClose();
  });

  return {
    showViewer,
    showCrypt,
    login,
    isOpen: () => dialog.open,
    myCode: () => myCode,
    // Live updates must not wipe what the owner is arranging or typing.
    refresh() {
      if (!dialog.open || dirty || body.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;
      if (myCode) reloadOwner().catch(() => {});
      else if (mode === 'grave' && plotIndex !== null && publicPlot(plotIndex)?.grave && closeup) closeup.set(publicPlot(plotIndex));
    },
    relabel() {
      if (!dialog.open || dirty) return;
      if (myCode) reloadOwner().catch(() => {});
      else if (mode === 'crypt') showCrypt(publicPlot(plotIndex).ad);
      else if (plotIndex !== null && publicPlot(plotIndex)?.grave) showViewer(plotIndex);
    },
  };
}
