const LIMIT = 280;
const WARN_AT = 20;

const form = document.getElementById('composer');
const input = document.getElementById('comment');
const list = document.getElementById('comment-list');
const counter = document.getElementById('counter');
const post = document.getElementById('post');

function remaining() {
  return LIMIT - input.value.trim().length;
}

function updateCounter() {
  const left = remaining();
  counter.textContent = left >= 0 ? `${left} characters left` : `${-left} characters over the limit`;
  counter.classList.toggle('warn', left >= 0 && left <= WARN_AT);
  counter.classList.toggle('over', left < 0);
  post.disabled = input.value.trim().length === 0 || left < 0;
}

input.addEventListener('input', updateCounter);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || remaining() < 0) return;
  const item = document.createElement('li');
  item.innerHTML = '<strong>You</strong>';
  const body = document.createElement('p');
  body.textContent = text;
  item.appendChild(body);
  list.appendChild(item);
  input.value = '';
  updateCounter();
});

updateCounter();
