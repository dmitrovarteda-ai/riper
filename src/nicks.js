import { UserError } from './core.js';

const ADJECTIVES = ['Грустный', 'Ржавый', 'Сонный', 'Бодрый', 'Лысый', 'Хитрый', 'Древний', 'Тихий', 'Весёлый', 'Пыльный', 'Кривой', 'Вечный', 'Голодный', 'Заблудший', 'Важный', 'Скромный'];
const NOUNS = ['Скелет', 'Череп', 'Призрак', 'Гробик', 'Могильщик', 'Ворон', 'Упырь', 'Крест', 'Склеп', 'Копатель', 'Венок', 'Сторож', 'Фонарь', 'Покойник', 'Тыквач', 'Некромант'];

// Roots that are not allowed anywhere in a nick: swearing, slurs, hate and sexual words, in both alphabets.
const BANNED_RU = [
  'хуй', 'хуе', 'хуи', 'хуя', 'хую', 'пизд', 'ебат', 'ебан', 'ебал', 'ебло', 'ебуч', 'ебну', 'еблан', 'бля', 'сука', 'суки', 'сучк', 'пидор', 'пидар', 'педик',
  'мудак', 'мудил', 'гандон', 'гондон', 'шлюх', 'залуп', 'дроч', 'манда', 'трахат', 'порн', 'секс', 'нигер', 'нигг', 'негр', 'хач', 'чурк', 'жид', 'хохол', 'хохл', 'москал',
  'гитлер', 'нацист', 'фашист', 'игил', 'суицид', 'самоубий', 'педофил', 'дебил', 'даун',
];
const BANNED_EN = [
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'nigg', 'niger', 'fag', 'whore', 'slut', 'rape', 'porn', 'sex', 'dick', 'cock', 'pussy', 'retard', 'hitler', 'nazi', 'kys', 'suicid', 'isis', 'pedo',
  'huy', 'hui', 'pizd', 'blyat', 'blya', 'suka', 'pidor', 'pidar', 'ebat', 'mudak', '1488', 'sieg',
];

const TO_CYRILLIC = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'и', 0: 'о', 3: 'з', 4: 'ч', 6: 'б' };
const TO_LATIN = { а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', к: 'k', м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y', 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

const squeeze = (text) => text.replace(/[^\p{L}\p{N}]/gu, '').replace(/(.)\1+/gu, '$1');
const mapChars = (text, table) => [...text].map((char) => table[char] ?? char).join('');

export function isCleanNick(nick) {
  const plain = nick.toLowerCase().replace(/ё/g, 'е');
  // Numbers are checked before squeezing, because 1488 and friends lose meaning without their digits.
  if (BANNED_EN.some((word) => plain.replace(/[^\p{L}\p{N}]/gu, '').includes(word))) return false;
  const base = squeeze(plain);
  const cyrillic = mapChars(base, TO_CYRILLIC);
  const latin = mapChars(base, TO_LATIN);
  return !BANNED_RU.some((word) => cyrillic.includes(squeeze(word))) && !BANNED_EN.some((word) => latin.includes(squeeze(word)));
}

export function validateNick(input) {
  const nick = String(input ?? '').trim().replace(/\s+/g, ' ');
  const length = [...nick].length;
  if (length < 2 || length > 20 || !/^[\p{L}\p{N} _-]+$/u.test(nick) || !isCleanNick(nick)) throw new UserError('bad_nick');
  return nick;
}

export function randomNick(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}
