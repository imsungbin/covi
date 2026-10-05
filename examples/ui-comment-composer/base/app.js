const form = document.getElementById('composer');
const input = document.getElementById('comment');
const list = document.getElementById('comment-list');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const item = document.createElement('li');
  item.innerHTML = '<strong>You</strong>';
  const body = document.createElement('p');
  body.textContent = text;
  item.appendChild(body);
  list.appendChild(item);
  input.value = '';
});
