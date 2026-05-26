<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();
  let saving = $state(false);
</script>

<svelte:head><title>Setup · RookRipper</title></svelte:head>

<div class="setup">
  <h1>Setup</h1>

  {#if data.hasToken && data.username}
    <p class="connected">Connected as <strong>{data.username}</strong></p>
  {/if}

  <p class="help">
    Generate a personal access token at
    <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer">
      lichess.org/account/oauth/token
    </a>
    with the <code>puzzle:read</code> scope. Your games are public and need no extra scope.
  </p>

  <form method="POST" action="?/save" use:enhance={() => {
    saving = true;
    return async ({ update }) => {
      saving = false;
      await update();
    };
  }}>
    <label for="token">Personal Access Token</label>
    <input
      id="token"
      name="token"
      type="password"
      placeholder="lip_xxxxxxxxxxxxxxxxxxxx"
      autocomplete="off"
      required
    />

    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}

    <button type="submit" disabled={saving}>
      {saving ? 'Verifying…' : data.hasToken ? 'Update Token' : 'Connect'}
    </button>
  </form>
</div>

<style>
  .setup {
    max-width: 440px;
  }

  h1 {
    font-size: 1.4rem;
    margin-bottom: 1rem;
  }

  .connected {
    background: #1e3a24;
    color: #6dbf67;
    padding: 0.5rem 0.8rem;
    border-radius: 4px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .help {
    font-size: 0.85rem;
    color: #888;
    margin-bottom: 1.2rem;
    line-height: 1.6;
  }

  .help a {
    color: #7eb3e0;
  }

  code {
    background: #2a2a2a;
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-size: 0.85em;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  label {
    font-size: 0.85rem;
    color: #aaa;
  }

  input {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #e8e8e8;
    padding: 0.55rem 0.8rem;
    border-radius: 4px;
    font-size: 0.95rem;
    width: 100%;
  }

  input:focus {
    outline: none;
    border-color: #7eb3e0;
  }

  .error {
    color: #e07070;
    font-size: 0.85rem;
  }

  button[type='submit'] {
    background: #4a90d9;
    color: white;
    padding: 0.6rem;
    align-self: flex-start;
    min-width: 120px;
  }

  button:disabled {
    opacity: 0.5;
  }
</style>
