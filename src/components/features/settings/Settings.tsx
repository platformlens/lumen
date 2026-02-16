import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon, Check, Shield, ChevronDown, ChevronUp,
  FolderOpen, Info, Activity
} from 'lucide-react';
import { GlassButton } from '../../shared/GlassButton';
import { ToggleGroup } from '../../shared/ToggleGroup';
import packageJson from '../../../../package.json';
import logoUrl from '../../../assets/logo.png';

interface SettingsProps {
  activeSection?: string;
}

export const Settings: React.FC<SettingsProps> = ({ activeSection = 'settings-general' }) => {
  // AI Provider State
  const [selectedProvider, setSelectedProvider] = useState<string>(() =>
    window.k8s.getProviderSync()
  );
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return window.k8s.getModelSync();
  });

  // Google State
  const [inputKey, setInputKey] = useState('');
  const [savedKey, setSavedKey] = useState('');

  // AWS State
  const [awsAccessKey, setAwsAccessKey] = useState('');
  const [awsSecretKey, setAwsSecretKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');
  const [awsSessionToken, setAwsSessionToken] = useState('');
  const [awsProfiles, setAwsProfiles] = useState<string[]>([]);
  const [selectedAwsProfile, setSelectedAwsProfile] = useState('default');
  const [grantedInfo, setGrantedInfo] = useState<{ active: boolean; configured: boolean; envProfile?: string; configProfiles: string[] }>({ active: false, configured: false, configProfiles: [] });
  const [awsIdentity, setAwsIdentity] = useState<string | null>(null);

  const [isSaved, setIsSaved] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const [googleModels, setGoogleModels] = useState<Array<{ id: string; name: string }>>([]);
  const [bedrockModels, setBedrockModels] = useState<Array<{ id: string; name: string }>>([]);

  const [awsAuthType, setAwsAuthType] = useState<'none' | 'manual' | 'managed'>('none');
  const [forceManualAws, setForceManualAws] = useState(false);
  const [showGrantedProfiles, setShowGrantedProfiles] = useState(false);

  // General Settings State
  const [kubeconfigPath, setKubeconfigPath] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [defaultNamespace, setDefaultNamespace] = useState('all');
  const [showSystemNamespaces, setShowSystemNamespaces] = useState(false);
  const [enableNotifications, setEnableNotifications] = useState(true);
  const [maxLogLines, setMaxLogLines] = useState(1000);

  // Editor & Terminal State
  const [editorFontSize, setEditorFontSize] = useState(14);
  const [editorWordWrap, setEditorWordWrap] = useState(true);
  const [terminalFontSize, setTerminalFontSize] = useState(13);

  // Context Engine State
  const [tokenBudget, setTokenBudget] = useState(2000);
  const [summariesEnabled, setSummariesEnabled] = useState(true);
  const [anomalyDetectionEnabled, setAnomalyDetectionEnabled] = useState(true);
  const [contextStatus, setContextStatus] = useState<{ resourceCount: number; lastUpdate: number }>({ resourceCount: 0, lastUpdate: 0 });

  // Load all settings on mount
  useEffect(() => {
    // General settings
    window.k8s.settings.getAll().then(s => {
      setRefreshInterval(s.refreshInterval);
      setDefaultNamespace(s.defaultNamespace);
      setShowSystemNamespaces(s.showSystemNamespaces);
      setEnableNotifications(s.enableNotifications);
      setMaxLogLines(s.maxLogLines);
      setEditorFontSize(s.editorFontSize);
      setEditorWordWrap(s.editorWordWrap);
      setTerminalFontSize(s.terminalFontSize);
    });
    window.k8s.settings.getKubeconfigPath().then(setKubeconfigPath);

    // Context Engine config
    window.k8s.settings.getContextConfig().then((config: any) => {
      if (config) {
        setTokenBudget(config.tokenBudget ?? 2000);
        setSummariesEnabled(config.summariesEnabled ?? true);
        setAnomalyDetectionEnabled(config.anomalyDetectionEnabled ?? true);
      }
    });
    window.k8s.context.getStatus().then((status: any) => {
      if (status) setContextStatus(status);
    });

    // AI settings
    window.k8s.getApiKey().then(key => {
      if (key) setSavedKey(key);
    });

    // AWS Auth
    window.k8s.checkAwsAuth().then(result => {
      if (result.isAuthenticated && result.isManaged) {
        setAwsAuthType('managed');
      } else if (result.isAuthenticated) {
        setAwsAuthType('manual');
      } else {
        setAwsAuthType('none');
      }

      window.k8s.getAwsCreds().then(creds => {
        if (creds && creds.accessKeyId) {
          setAwsAccessKey(creds.accessKeyId);
          setAwsSecretKey(creds.secretAccessKey);
          setAwsRegion(creds.region);
          setAwsSessionToken(creds.sessionToken || '');
          if (!result.isManaged) setAwsAuthType('manual');
        }
      });
    });

    // AWS profiles
    window.k8s.aws.listProfiles().then(setAwsProfiles);
    window.k8s.aws.getProfile().then(profile => setSelectedAwsProfile(profile || 'default'));

    // Granted
    Promise.all([
      window.k8s.aws.isGrantedActive(),
      window.k8s.aws.isGrantedConfigured(),
      window.k8s.aws.getGrantedCredentials(),
    ]).then(([envActive, configResult, envCreds]) => {
      setGrantedInfo({
        active: envActive,
        configured: configResult?.configured || false,
        envProfile: envCreds?.profile || undefined,
        configProfiles: configResult?.profiles || [],
      });
    });

    // AWS identity
    window.k8s.aws.getCallerIdentity().then(result => {
      if (result?.isAuthenticated && result?.identity) {
        setAwsIdentity(result.identity);
      }
    });
  }, []);

  // Credential file change listener
  useEffect(() => {
    const cleanup = window.k8s.aws.onCredentialsChanged((data) => {
      setAwsIdentity(data.identity);
      if (data.profile) setSelectedAwsProfile(data.profile);

      Promise.all([
        window.k8s.aws.isGrantedActive(),
        window.k8s.aws.isGrantedConfigured(),
        window.k8s.aws.getGrantedCredentials(),
      ]).then(([envActive, configResult, envCreds]) => {
        setGrantedInfo({
          active: envActive,
          configured: configResult?.configured || false,
          envProfile: envCreds?.profile || undefined,
          configProfiles: configResult?.profiles || [],
        });
      });

      window.k8s.checkAwsAuth().then(result => {
        if (result.isAuthenticated) {
          setAwsAuthType(result.isManaged ? 'managed' : 'manual');
        }
      });

      window.k8s.listModels('bedrock').then(models => {
        if (models && models.length > 0) setBedrockModels(models);
      });
    });
    return cleanup;
  }, []);

  // Fetch Google models when key changes
  useEffect(() => {
    if (savedKey) {
      window.k8s.listModels('google').then(models => {
        if (models && models.length > 0) {
          setGoogleModels(models);
        } else {
          setGoogleModels([
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
            { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp' },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
          ]);
        }
      });
    }
  }, [savedKey]);

  // Fetch Bedrock models when auth changes
  useEffect(() => {
    if (awsAuthType !== 'none' || (awsAccessKey && awsSecretKey)) {
      window.k8s.listModels('bedrock').then(models => {
        if (models && models.length > 0) {
          setBedrockModels(models);
        } else {
          setBedrockModels([
            { id: 'anthropic.claude-3-sonnet-20240229-v1:0', name: 'Claude 3 Sonnet (Fallback)' },
            { id: 'anthropic.claude-3-haiku-20240307-v1:0', name: 'Claude 3 Haiku (Fallback)' },
          ]);
        }
      });
    }
  }, [awsAuthType, awsAccessKey, awsSecretKey]);

  // Handlers
  const handleSaveApiKey = async () => {
    if (!inputKey) return;
    await window.k8s.saveApiKey(inputKey);
    setSavedKey(inputKey);
    setInputKey('');
    setEditMode(false);
    showSavedFeedback();
  };

  const handleSaveAwsCreds = async () => {
    await window.k8s.saveAwsCreds({
      accessKeyId: awsAccessKey,
      secretAccessKey: awsSecretKey,
      region: awsRegion,
      sessionToken: awsSessionToken
    });
    showSavedFeedback();
  };

  const showSavedFeedback = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleModelChange = (modelId: string, provider: string) => {
    setSelectedModel(modelId);
    setSelectedProvider(provider);
    window.k8s.saveModelSelection(provider, modelId);
    window.dispatchEvent(new CustomEvent('aiModelChanged', {
      detail: { provider, model: modelId }
    }));
  };

  const getMaskedKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 6) return key;
    return '•'.repeat(key.length - 6) + key.slice(-6);
  };

  const handleSaveGeneralSettings = async () => {
    await Promise.all([
      window.k8s.settings.set('refreshInterval', refreshInterval),
      window.k8s.settings.set('defaultNamespace', defaultNamespace),
      window.k8s.settings.set('showSystemNamespaces', showSystemNamespaces),
      window.k8s.settings.set('enableNotifications', enableNotifications),
      window.k8s.settings.set('maxLogLines', maxLogLines),
    ]);
    showSavedFeedback();
  };

  const handleSaveEditorSettings = async () => {
    await Promise.all([
      window.k8s.settings.set('editorFontSize', editorFontSize),
      window.k8s.settings.set('editorWordWrap', editorWordWrap),
      window.k8s.settings.set('terminalFontSize', terminalFontSize),
    ]);
    showSavedFeedback();
  };

  const handleSaveContextConfig = async () => {
    await window.k8s.settings.setContextConfig({
      tokenBudget,
      summariesEnabled,
      anomalyDetectionEnabled,
    });
    // Refresh status after saving
    const status = await window.k8s.context.getStatus();
    if (status) setContextStatus(status);
    showSavedFeedback();
  };

  const handleSaveKubeconfigPath = async () => {
    await window.k8s.settings.setKubeconfigPath(kubeconfigPath);
    showSavedFeedback();
  };

  // Shared UI components
  const Section: React.FC<{ title: string; accent: string; children: React.ReactNode }> = ({ title, accent, children }) => (
    <section>
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <div className={`w-1 h-6 ${accent} rounded-full`}></div>
        {title}
      </h3>
      <div className="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-5 shadow-xl shadow-black/20">
        {children}
      </div>
    </section>
  );

  const SettingRow: React.FC<{ label: string; description?: string; children: React.ReactNode }> = ({ label, description, children }) => (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white">{label}</div>
        {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );

  const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
    <button
      onClick={() => onChange(!checked)}
      className={`w-10 h-5 rounded-full transition-colors relative ${checked ? 'bg-blue-500' : 'bg-white/10'}`}
    >
      <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${checked ? 'translate-x-5.5 left-[1px]' : 'left-[2px]'}`}
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  );

  const NumberInput: React.FC<{ value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; className?: string }> = ({ value, onChange, min, max, step = 1, className = 'w-24' }) => (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className={`bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500/50 ${className}`}
    />
  );

  // Section titles for the header
  const sectionTitles: Record<string, string> = {
    'settings-general': 'General',
    'settings-ai': 'AI Models',
    'settings-context': 'AI Context Engine',
    'settings-editor': 'Editor & Terminal',
    'settings-about': 'About',
  };

  const renderGeneralSection = () => (
    <div className="space-y-8">
      {/* Kubeconfig */}
      <Section title="Kubeconfig" accent="bg-blue-500">
        <SettingRow label="Kubeconfig Path" description="Path to your Kubernetes configuration file">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={kubeconfigPath}
              onChange={(e) => setKubeconfigPath(e.target.value)}
              className="w-80 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-blue-500/50"
              placeholder="~/.kube/config"
            />
            <GlassButton onClick={handleSaveKubeconfigPath} variant="primary" className="text-xs px-3 py-1.5">
              <FolderOpen size={14} />
            </GlassButton>
          </div>
        </SettingRow>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Info size={12} />
          <span>Changes take effect after restarting the app</span>
        </div>
      </Section>

      {/* Cluster Defaults */}
      <Section title="Cluster Defaults" accent="bg-green-500">
        <SettingRow label="Default Namespace" description="Namespace selected when connecting to a cluster">
          <select
            value={defaultNamespace}
            onChange={(e) => setDefaultNamespace(e.target.value)}
            className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500/50"
          >
            <option value="all" className="bg-gray-900">All Namespaces</option>
            <option value="default" className="bg-gray-900">default</option>
          </select>
        </SettingRow>
        <SettingRow label="Show System Namespaces" description="Include kube-system, kube-public, etc. in namespace lists">
          <Toggle checked={showSystemNamespaces} onChange={setShowSystemNamespaces} />
        </SettingRow>
        <SettingRow label="Refresh Interval" description="Seconds between metric refreshes (pods, nodes)">
          <div className="flex items-center gap-2">
            <NumberInput value={refreshInterval} onChange={setRefreshInterval} min={5} max={300} />
            <span className="text-xs text-gray-500">sec</span>
          </div>
        </SettingRow>
      </Section>

      {/* Behavior */}
      <Section title="Behavior" accent="bg-purple-500">
        <SettingRow label="Notifications" description="Show toast notifications for actions like delete, scale, etc.">
          <Toggle checked={enableNotifications} onChange={setEnableNotifications} />
        </SettingRow>
        <SettingRow label="Max Log Lines" description="Maximum lines to keep in the log viewer buffer">
          <NumberInput value={maxLogLines} onChange={setMaxLogLines} min={100} max={10000} step={100} />
        </SettingRow>
      </Section>

      <div className="flex justify-end">
        <GlassButton
          onClick={handleSaveGeneralSettings}
          variant={isSaved ? 'secondary' : 'primary'}
          className={isSaved ? 'bg-green-500/10 text-green-400 border-green-500/20' : ''}
          icon={isSaved ? <Check size={16} /> : undefined}
        >
          {isSaved ? 'Saved' : 'Save Settings'}
        </GlassButton>
      </div>
    </div>
  );

  const renderAISection = () => (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
            AI Provider Configuration
          </h3>
          <ToggleGroup
            options={[
              { value: 'google', label: 'Google Gemini' },
              { value: 'bedrock', label: 'AWS Bedrock' }
            ]}
            value={selectedProvider}
            onChange={(provider) => handleModelChange(selectedModel, provider)}
          />
        </div>

        {selectedProvider === 'google' ? (
          <div className="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-4 shadow-xl shadow-black/20">
            <p className="text-sm text-gray-400">
              Enter your Gemini API Key here. {savedKey ? "A key is currently saved." : "No key is currently saved."}
            </p>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={editMode ? inputKey : getMaskedKey(savedKey)}
                  onChange={(e) => setInputKey(e.target.value)}
                  onFocus={() => setEditMode(true)}
                  onBlur={() => { if (!inputKey) setEditMode(false); }}
                  placeholder={editMode ? "Enter new API Key..." : "Enter your API Key..."}
                  className={`w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/50 focus:bg-black/60 transition-all placeholder:text-gray-600 ${!editMode && savedKey ? 'font-mono tracking-widest text-gray-300' : ''}`}
                />
              </div>
              <GlassButton
                onClick={handleSaveApiKey}
                variant={isSaved ? 'secondary' : 'primary'}
                className={isSaved ? 'bg-green-500/10 text-green-400 border-green-500/20' : ''}
                icon={isSaved ? <Check size={16} /> : undefined}
              >
                {isSaved ? 'Saved' : 'Save Key'}
              </GlassButton>
            </div>
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-2">Available Models</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {googleModels.map(model => (
                  <div
                    key={model.id}
                    onClick={() => handleModelChange(model.id, 'google')}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border border-transparent ${selectedModel === model.id ? 'bg-blue-500/20 border-blue-500/50 shadow-inner' : 'bg-black/20 hover:bg-black/40 border-white/5'}`}
                  >
                    <span className={`text-sm ${selectedModel === model.id ? 'text-blue-200' : 'text-gray-400'}`}>{model.name}</span>
                    {selectedModel === model.id && <Check size={14} className="text-blue-400" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-4 shadow-xl shadow-black/20">
            <p className="text-sm text-gray-400">
              Configure AWS Credentials for Bedrock access.
              {awsAuthType === 'managed' && <span className="text-green-400 ml-2 font-semibold">✓ Authenticated via Environment/SSO</span>}
            </p>

            {/* AWS Profile Selector */}
            {awsProfiles.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs text-gray-500">AWS Profile</label>
                <select
                  value={selectedAwsProfile}
                  onChange={async (e) => {
                    const profile = e.target.value;
                    setSelectedAwsProfile(profile);
                    const setResult = await window.k8s.aws.setProfile(profile);
                    if (setResult?.identity) {
                      setAwsIdentity(setResult.identity);
                    } else {
                      const identity = await window.k8s.aws.getCallerIdentity();
                      setAwsIdentity(identity?.isAuthenticated ? identity.identity : null);
                    }
                    const result = await window.k8s.checkAwsAuth();
                    if (result.isAuthenticated && result.isManaged) setAwsAuthType('managed');
                    else if (result.isAuthenticated) setAwsAuthType('manual');
                    else setAwsAuthType('none');
                    const models = await window.k8s.listModels('bedrock');
                    if (models && models.length > 0) setBedrockModels(models);
                  }}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500/50"
                >
                  {awsProfiles.map(profile => (
                    <option key={profile} value={profile} className="bg-gray-900">{profile}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Granted Detection Banner */}
            {(grantedInfo.active || grantedInfo.configured) && (
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Shield className="text-purple-400 flex-shrink-0" size={18} />
                    <div className="min-w-0">
                      <div className="text-sm text-purple-200">
                        {grantedInfo.active
                          ? `Granted credentials active${grantedInfo.envProfile ? ` — ${grantedInfo.envProfile}` : ''}`
                          : `Granted detected — ${grantedInfo.configProfiles.length} profiles configured`}
                      </div>
                      {awsIdentity && (
                        <div className="text-xs text-purple-300/70 mt-0.5 font-mono truncate">{awsIdentity}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {grantedInfo.configProfiles.length > 0 && (
                      <button onClick={() => setShowGrantedProfiles(prev => !prev)} className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                        {showGrantedProfiles ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {showGrantedProfiles ? 'Hide' : 'Profiles'}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        await window.k8s.aws.setProfile(selectedAwsProfile);
                        const [envActive, configResult, envCreds] = await Promise.all([
                          window.k8s.aws.isGrantedActive(),
                          window.k8s.aws.isGrantedConfigured(),
                          window.k8s.aws.getGrantedCredentials(),
                        ]);
                        setGrantedInfo({ active: envActive, configured: configResult?.configured || false, envProfile: envCreds?.profile || undefined, configProfiles: configResult?.profiles || [] });
                        const identity = await window.k8s.aws.getCallerIdentity();
                        setAwsIdentity(identity?.isAuthenticated ? identity.identity : null);
                        const result = await window.k8s.checkAwsAuth();
                        if (result.isAuthenticated) setAwsAuthType(result.isManaged ? 'managed' : 'manual');
                        const models = await window.k8s.listModels('bedrock');
                        if (models && models.length > 0) setBedrockModels(models);
                      }}
                      className="text-xs text-purple-400 hover:text-purple-300 underline"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                {showGrantedProfiles && grantedInfo.configProfiles.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto bg-black/20 rounded-lg p-2 space-y-0.5">
                    {grantedInfo.configProfiles.map(profile => (
                      <div key={profile} className="text-xs text-purple-300/60 font-mono py-0.5 px-1 hover:text-purple-200 hover:bg-purple-500/10 rounded">{profile}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Active Identity */}
            {!grantedInfo.active && !grantedInfo.configured && awsIdentity && (
              <div className="text-xs text-gray-500 font-mono bg-black/20 rounded-lg px-3 py-2">
                Identity: {awsIdentity}
              </div>
            )}

            {awsAuthType === 'managed' && !forceManualAws && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="text-green-400" size={18} />
                  <div className="text-sm text-green-200">Using managed credentials (SSO/Environment). No manual keys required.</div>
                </div>
                <button onClick={() => setForceManualAws(true)} className="text-xs text-green-400 hover:text-green-300 underline">Override with Manual Keys</button>
              </div>
            )}

            {(awsAuthType !== 'managed' || forceManualAws) && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-1 space-y-1">
                    <label className="text-xs text-gray-500">Region</label>
                    <input type="text" value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" placeholder="us-east-1" />
                  </div>
                  <div className="col-span-1 space-y-1">
                    <label className="text-xs text-gray-500">Access Key ID</label>
                    <input type="text" value={awsAccessKey} onChange={(e) => setAwsAccessKey(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" placeholder="AKIA..." />
                  </div>
                  <div className="col-span-1 space-y-1">
                    <label className="text-xs text-gray-500">Secret Access Key</label>
                    <input type="password" value={awsSecretKey} onChange={(e) => setAwsSecretKey(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" placeholder="Secret Key" />
                  </div>
                  <div className="col-span-1 space-y-1">
                    <label className="text-xs text-gray-500">Session Token (Optional)</label>
                    <input type="password" value={awsSessionToken} onChange={(e) => setAwsSessionToken(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm" placeholder="Session Token" />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  {awsAuthType === 'managed' && (
                    <button onClick={() => setForceManualAws(false)} className="mr-auto text-xs text-gray-500 hover:text-gray-300">Cancel Override</button>
                  )}
                  <GlassButton
                    onClick={handleSaveAwsCreds}
                    variant={isSaved ? 'secondary' : 'primary'}
                    className={isSaved ? 'bg-green-500/10 text-green-400 border-green-500/20' : ''}
                    icon={isSaved ? <Check size={16} /> : undefined}
                  >
                    {isSaved ? 'Saved AWS Creds' : 'Save AWS Creds'}
                  </GlassButton>
                </div>
              </>
            )}

            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-2">Available Models</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {bedrockModels.map(model => (
                  <div
                    key={model.id}
                    onClick={() => handleModelChange(model.id, 'bedrock')}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border border-transparent ${selectedModel === model.id ? 'bg-blue-500/20 border-blue-500/50 shadow-inner' : 'bg-black/20 hover:bg-black/40 border-white/5'}`}
                  >
                    <span className={`text-sm ${selectedModel === model.id ? 'text-blue-200' : 'text-gray-400'}`}>{model.name}</span>
                    {selectedModel === model.id && <Check size={14} className="text-blue-400" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-500 mt-2 px-1">
          <Shield size={12} />
          <span>Stored locally in encrypted configuration</span>
        </div>
      </section>
    </div>
  );

  const renderEditorSection = () => (
    <div className="space-y-8">
      <Section title="YAML Editor" accent="bg-yellow-500">
        <SettingRow label="Font Size" description="Font size for the Monaco YAML editor">
          <div className="flex items-center gap-2">
            <NumberInput value={editorFontSize} onChange={setEditorFontSize} min={10} max={24} />
            <span className="text-xs text-gray-500">px</span>
          </div>
        </SettingRow>
        <SettingRow label="Word Wrap" description="Wrap long lines in the editor">
          <Toggle checked={editorWordWrap} onChange={setEditorWordWrap} />
        </SettingRow>
      </Section>

      <Section title="Terminal" accent="bg-cyan-500">
        <SettingRow label="Font Size" description="Font size for the integrated terminal">
          <div className="flex items-center gap-2">
            <NumberInput value={terminalFontSize} onChange={setTerminalFontSize} min={10} max={24} />
            <span className="text-xs text-gray-500">px</span>
          </div>
        </SettingRow>
      </Section>

      <div className="flex justify-end">
        <GlassButton
          onClick={handleSaveEditorSettings}
          variant={isSaved ? 'secondary' : 'primary'}
          className={isSaved ? 'bg-green-500/10 text-green-400 border-green-500/20' : ''}
          icon={isSaved ? <Check size={16} /> : undefined}
        >
          {isSaved ? 'Saved' : 'Save Settings'}
        </GlassButton>
      </div>
    </div>
  );

  const renderContextSection = () => (
    <div className="space-y-8">
      <Section title="Token Budget" accent="bg-blue-500">
        <SettingRow label="Max Context Tokens" description="Maximum tokens allocated for cluster context in AI prompts (500–5000)">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={500}
              max={5000}
              step={100}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(Number(e.target.value))}
              className="w-40 accent-blue-500"
            />
            <span className="text-sm text-white font-mono w-14 text-right">{tokenBudget}</span>
          </div>
        </SettingRow>
      </Section>

      <Section title="Features" accent="bg-purple-500">
        <SettingRow label="View Summaries" description="Show AI-generated summaries at the top of resource views">
          <Toggle checked={summariesEnabled} onChange={setSummariesEnabled} />
        </SettingRow>
        <SettingRow label="Anomaly Detection" description="Proactively detect and alert on cluster anomalies">
          <Toggle checked={anomalyDetectionEnabled} onChange={setAnomalyDetectionEnabled} />
        </SettingRow>
      </Section>

      <Section title="Context Store Status" accent="bg-green-500">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-green-400" />
            <span className="text-sm text-gray-400">Tracked Resources</span>
            <span className="text-sm text-white font-mono">{contextStatus.resourceCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Last Update</span>
            <span className="text-sm text-white font-mono">
              {contextStatus.lastUpdate > 0
                ? new Date(contextStatus.lastUpdate).toLocaleTimeString()
                : 'N/A'}
            </span>
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <GlassButton
          onClick={handleSaveContextConfig}
          variant={isSaved ? 'secondary' : 'primary'}
          className={isSaved ? 'bg-green-500/10 text-green-400 border-green-500/20' : ''}
          icon={isSaved ? <Check size={16} /> : undefined}
        >
          {isSaved ? 'Saved' : 'Save Settings'}
        </GlassButton>
      </div>
    </div>
  );

  const renderAboutSection = () => (
    <div className="space-y-8">
      <Section title="About Lumen" accent="bg-gray-500">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-white font-semibold text-lg">Lumen</h4>
            <p className="text-gray-400 text-sm">Kubernetes Management Tool</p>
          </div>
          <div className="w-16 h-16 rounded-xl overflow-hidden">
            <img src={logoUrl} alt="Lumen Logo" className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="space-y-3 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Version</span>
            <span className="text-white font-mono">{packageJson.version}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Electron</span>
            <span className="text-white font-mono">{packageJson.devDependencies?.electron?.replace('^', '') || '-'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">React</span>
            <span className="text-white font-mono">{packageJson.dependencies?.react?.replace('^', '') || '-'}</span>
          </div>
        </div>
      </Section>

      <Section title="Shortcuts" accent="bg-orange-500">
        <div className="space-y-2">
          {[
            { keys: '⌘ + K', action: 'Open AI Assistant' },
            { keys: '⌘ + ,', action: 'Open Settings' },
            { keys: '⌘ + `', action: 'Toggle Terminal' },
            { keys: '⌘ + L', action: 'Open Logs' },
          ].map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between text-sm">
              <span className="text-gray-400">{action}</span>
              <kbd className="px-2 py-0.5 bg-black/40 border border-white/10 rounded text-xs text-gray-300 font-mono">{keys}</kbd>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'settings-general': return renderGeneralSection();
      case 'settings-ai': return renderAISection();
      case 'settings-context': return renderContextSection();
      case 'settings-editor': return renderEditorSection();
      case 'settings-about': return renderAboutSection();
      default: return renderGeneralSection();
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Top Bar */}
      <div className="flex-none p-6 border border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between rounded-2xl mx-6 mt-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-lg shadow-black/20">
            <SettingsIcon className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">{sectionTitles[activeSection] || 'Settings'}</h1>
            <div className="text-sm text-gray-400">
              {activeSection === 'settings-general' && 'Kubeconfig, cluster defaults, and app behavior'}
              {activeSection === 'settings-ai' && 'Configure AI providers and model selection'}
              {activeSection === 'settings-context' && 'Token budget, view summaries, and anomaly detection'}
              {activeSection === 'settings-editor' && 'YAML editor and terminal preferences'}
              {activeSection === 'settings-about' && 'Version info and keyboard shortcuts'}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="max-w-4xl mx-auto">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};
