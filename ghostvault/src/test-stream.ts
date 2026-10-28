import { SlidingStreamTransformer } from './proxy/sliding-buffer.js';

const replacements = [
  { from: '$${<BANK_API_URL>}', to: 'https://internal.bank.kz/api/v1' },
  { from: '$${<AUTH_TOKEN>}', to: 'secret_jwt_token_prod_99a81c' },
];

const transformer = new SlidingStreamTransformer(replacements, 32);

const chunks = [
  'Привет! Я начинаю вы',
  'полнение запроса к $${<BA',
  'NK_API_URL>}/pay',
  'ment с токеном ',
  '$${<AUTH_TOKEN>} прямо ',
  'сейчас.',
];

let streamOutput = '';
for (const chunk of chunks) {
  streamOutput += transformer.push(chunk);
}
streamOutput += transformer.flush();

const expected = 'Привет! Я начинаю выполнение запроса к https://internal.bank.kz/api/v1/payment с токеном secret_jwt_token_prod_99a81c прямо сейчас.';
if (streamOutput === expected) {
  console.log('Stream test: OK');
} else {
  process.exit(1);
}
