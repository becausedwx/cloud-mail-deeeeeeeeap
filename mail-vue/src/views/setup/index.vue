<template>
  <main class="setup-page">
    <section class="setup-card">
      <div class="setup-brand">Cloud Mail</div>
      <h1>{{ $t('setupTitle') }}</h1>
      <p class="setup-description">{{ $t('setupDesc') }}</p>

      <div class="setup-status">
        <h2>{{ $t('setupStatusTitle') }}</h2>
        <div v-for="item in checks" :key="item.key" class="setup-check">
          <span>{{ item.label }}</span>
          <el-tag :type="item.ok ? 'success' : 'danger'" effect="light">
            {{ item.ok ? $t('setupConfigured') : $t('setupMissing') }}
          </el-tag>
        </div>
      </div>

      <template v-if="canInitialize">
        <el-alert
            :title="$t('setupInitRequired')"
            type="warning"
            :closable="false"
            show-icon
        />
        <p class="setup-command-label">{{ $t('setupInitCommand') }}</p>
        <div class="setup-command">
          <code>{{ initCommand }}</code>
          <el-button type="primary" plain @click="copyCommand">
            {{ $t('setupCopyCommand') }}
          </el-button>
        </div>
        <p class="setup-hint">{{ $t('setupCommandHint') }}</p>
      </template>

      <el-alert
          v-else-if="!status.ready"
          :title="$t('setupBindingsFirst')"
          type="info"
          :closable="false"
          show-icon
      />

      <div class="setup-actions">
        <el-button type="primary" :loading="checking" @click="refreshStatus">
          {{ $t('setupRefreshStatus') }}
        </el-button>
      </div>

      <p class="setup-footer">{{ $t('setupMaintenanceHint') }}</p>
    </section>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { bootstrapStatus } from '@/request/setting.js';
import { useSettingStore } from '@/store/setting.js';

const { t } = useI18n();
const settingStore = useSettingStore();
const status = ref(settingStore.settings?.bootstrap || {
  initialized: false,
  ready: false,
  bindings: {},
  configuration: {}
});
const checking = ref(false);

const checks = computed(() => [
  { key: 'd1', label: t('setupCheckD1'), ok: status.value.bindings?.d1 === true },
  { key: 'kv', label: t('setupCheckKv'), ok: status.value.bindings?.kv === true },
  { key: 'domain', label: t('setupCheckDomain'), ok: status.value.configuration?.domain === true },
  { key: 'admin', label: t('setupCheckAdmin'), ok: status.value.configuration?.admin === true },
  { key: 'secret', label: t('setupCheckSecret'), ok: status.value.configuration?.initSecret === true },
  { key: 'database', label: t('setupCheckDatabase'), ok: status.value.initialized === true }
]);

const canInitialize = computed(() => !status.value.initialized
    && status.value.bindings?.d1 === true
    && status.value.bindings?.kv === true
    && status.value.configuration?.domain === true
    && status.value.configuration?.admin === true
    && status.value.configuration?.initSecret === true);

const initCommand = computed(() => `curl -X POST -H "X-Cloud-Mail-Init-Secret: YOUR_JWT_SECRET" ${window.location.origin}/api/init`);

async function copyCommand() {
  await navigator.clipboard.writeText(initCommand.value);
  ElMessage.success(t('setupCopySuccess'));
}

async function refreshStatus() {
  checking.value = true;
  try {
    const nextStatus = await bootstrapStatus();
    status.value = nextStatus;
    settingStore.settings = {
      ...settingStore.settings,
      initialized: nextStatus.initialized,
      ready: nextStatus.ready,
      bootstrap: nextStatus
    };
    if (nextStatus.ready) {
      location.reload();
    }
  } finally {
    checking.value = false;
  }
}
</script>

<style scoped>
.setup-page {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px 18px;
  background:
      radial-gradient(circle at 15% 10%, rgba(24, 144, 255, 0.12), transparent 34%),
      radial-gradient(circle at 90% 85%, rgba(103, 194, 58, 0.1), transparent 32%),
      var(--el-bg-color-page);
}

.setup-card {
  width: min(680px, 100%);
  padding: 36px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
}

.setup-brand {
  color: var(--el-color-primary);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin-top: 8px;
  font-size: clamp(26px, 5vw, 36px);
  line-height: 1.2;
}

.setup-description {
  margin-top: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}

.setup-status {
  margin: 28px 0 22px;
  padding: 18px 20px;
  border-radius: 12px;
  background: var(--el-fill-color-light);
}

.setup-status h2 {
  margin-bottom: 10px;
  font-size: 16px;
}

.setup-check {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.setup-check:last-child {
  border-bottom: 0;
}

.setup-command-label {
  margin: 20px 0 8px;
  font-weight: 600;
}

.setup-command {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.setup-command code {
  min-width: 0;
  flex: 1;
  padding: 12px 14px;
  overflow-wrap: anywhere;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  line-height: 1.5;
}

.setup-hint,
.setup-footer {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.setup-hint {
  margin-top: 8px;
}

.setup-actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.setup-footer {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--el-border-color-lighter);
}

@media (max-width: 600px) {
  .setup-card {
    padding: 24px 20px;
  }

  .setup-command {
    flex-direction: column;
  }

  .setup-command .el-button {
    width: 100%;
  }
}
</style>
