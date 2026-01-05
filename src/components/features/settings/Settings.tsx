import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Check, Shield } from 'lucide-react';
import { GlassButton } from '../../shared/GlassButton';
import packageJson from '../../../../package.json';
import logoUrl from '../../../assets/logo.png';

export const Settings: React.FC = () => {
  const [selectedProvider, setSelectedProvider] = useState<string>('google');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');

  // Google State
  const [inputKey, setInputKey] = useState('');
  const [savedKey, setSavedKey] = useState('');

  // AWS State
  const [awsAccessKey, setAwsAccessKey] = useState('');
  const [awsSecretKey, setAwsSecretKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');
  const [awsSessionToken, setAwsSessionToken] = useState('');



  const [isSaved, setIsSaved] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // const googleModels = [
  //   { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
  //   { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  //   { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
  //   { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
  // ];
  const [googleModels, setGoogleModels] = useState<Array<{ id: string; name: string }>>([]);


  // const bedrockModels = [
  //   { id: 'anthropic.claude-3-sonnet-20240229-v1:0', name: 'Claude 3 Sonnet' },
  //   { id: 'anthropic.claude-3-haiku-20240307-v1:0', name: 'Claude 3 Haiku' },
  //   { id: 'anthropic.claude-3-opus-20240229-v1:0', name: 'Claude 3 Opus' },
  //   { id: 'amazon.titan-text-express-v1', name: 'Titan Text Express' }
  // ];
  const [bedrockModels, setBedrockModels] = useState<Array<{ id: string; name: string }>>([]);

  const [awsAuthType, setAwsAuthType] = useState<'none' | 'manual' | 'managed'>('none');
  const [forceManualAws, setForceManualAws] = useState(false);

  useEffect(() => {
    const savedModel = localStorage.getItem('k8ptain_model');
    const savedProvider = localStorage.getItem('k8ptain_provider');
    if (savedModel) setSelectedModel(savedModel);
    if (savedProvider) setSelectedProvider(savedProvider);

    // Load persisted API Key for Gemini
    window.k8s.getApiKey().then(key => {
      if (key) setSavedKey(key);
    });

    // Check AWS Auth
    window.k8s.checkAwsAuth().then(result => {
      if (result.isAuthenticated && result.isManaged) {
        setAwsAuthType('managed');
      } else if (result.isAuthenticated) {
        setAwsAuthType('manual');
      } else {
        setAwsAuthType('none');
      }

      // Load persisted AWS Creds regardless, to populate fields if they exist
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
  }, []);


  // Fetch models whenever savedKey changes (and is present)
  useEffect(() => {
    if (savedKey) {
      window.k8s.listModels('google').then(models => {
        if (models && models.length > 0) {
          setGoogleModels(models);
        } else {
          // Fallback
          setGoogleModels([
            { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp' },
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
          ]);
        }
      });
    }
  }, [savedKey]);

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
      })
    }
  }, [awsAuthType, awsAccessKey, awsSecretKey]);


  const handleSaveApiKey = async () => {
    if (!inputKey) return;

    await window.k8s.saveApiKey(inputKey);
    setSavedKey(inputKey);
    setInputKey('');
    setEditMode(false);
    showSavedFeedback();
  };

  const handleSaveAwsCreds = async () => {
    const creds = {
      accessKeyId: awsAccessKey,
      secretAccessKey: awsSecretKey,
      region: awsRegion,
      sessionToken: awsSessionToken
    };
    await window.k8s.saveAwsCreds(creds);

    showSavedFeedback();
  };

  const showSavedFeedback = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  }

  const handleModelChange = (modelId: string, provider: string) => {
    setSelectedModel(modelId);
    setSelectedProvider(provider);
    localStorage.setItem('k8ptain_model', modelId);
    localStorage.setItem('k8ptain_provider', provider);
  };

  const getMaskedKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 6) return key; // Or mask all?
    return '•'.repeat(key.length - 6) + key.slice(-6);
  };

  const handleInputFocus = () => {
    setEditMode(true);
  };

  const handleInputBlur = () => {
    if (!inputKey) {
      setEditMode(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Top Bar - Matching Dashboard.tsx style */}
      <div className="flex-none p-6 border border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between rounded-2xl mx-6 mt-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-lg shadow-black/20">
            <SettingsIcon className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              Configure application preferences and connections
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="max-w-4xl mx-auto space-y-8">

          {/* AI Provider & Key Section */}
          <section>
            <div className="flex items-center gap-4 mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
                AI Provider Configuration
              </h3>
              <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
                <button
                  onClick={() => setSelectedProvider('google')}
                  className={`px-4 py-1.5 rounded-md text-sm transition-all ${selectedProvider === 'google' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                >
                  Google Gemini
                </button>
                <button
                  onClick={() => setSelectedProvider('bedrock')}
                  className={`px-4 py-1.5 rounded-md text-sm transition-all ${selectedProvider === 'bedrock' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                >
                  AWS Bedrock
                </button>
              </div>
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
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
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
                        className={`
                                    flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border border-transparent
                                    ${selectedModel === model.id
                            ? 'bg-blue-500/20 border-blue-500/50 shadow-inner'
                            : 'bg-black/20 hover:bg-black/40 border-white/5'
                          }
                                 `}
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

                {awsAuthType === 'managed' && !forceManualAws && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className="text-green-400" size={18} />
                      <div className="text-sm text-green-200">
                        Using managed credentials (SSO/Environment). No manual keys required.
                      </div>
                    </div>
                    <button
                      onClick={() => setForceManualAws(true)}
                      className="text-xs text-green-400 hover:text-green-300 underline"
                    >
                      Override with Manual Keys
                    </button>
                  </div>
                )}

                {(awsAuthType !== 'managed' || forceManualAws) && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-1 space-y-1">
                        <label className="text-xs text-gray-500">Region</label>
                        <input
                          type="text"
                          value={awsRegion}
                          onChange={(e) => setAwsRegion(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
                          placeholder="us-east-1"
                        />
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-xs text-gray-500">Access Key ID</label>
                        <input
                          type="text"
                          value={awsAccessKey}
                          onChange={(e) => setAwsAccessKey(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
                          placeholder="AKIA..."
                        />
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-xs text-gray-500">Secret Access Key</label>
                        <input
                          type="password"
                          value={awsSecretKey}
                          onChange={(e) => setAwsSecretKey(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
                          placeholder="Secret Key"
                        />
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-xs text-gray-500">Session Token (Optional)</label>
                        <input
                          type="password"
                          value={awsSessionToken}
                          onChange={(e) => setAwsSessionToken(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white text-sm"
                          placeholder="Session Token"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      {awsAuthType === 'managed' && (
                        <button
                          onClick={() => setForceManualAws(false)}
                          className="mr-auto text-xs text-gray-500 hover:text-gray-300"
                        >
                          Cancel Override
                        </button>
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
                        className={`
                                    flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border border-transparent
                                    ${selectedModel === model.id
                            ? 'bg-blue-500/20 border-blue-500/50 shadow-inner'
                            : 'bg-black/20 hover:bg-black/40 border-white/5'
                          }
                                 `}
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

          {/* About Section */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <div className="w-1 h-6 bg-gray-500 rounded-full"></div>
              About
            </h3>
            <div className="bg-white/5 rounded-2xl border border-white/10 p-6 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-white font-semibold">Lumen</h4>
                  <p className="text-gray-400 text-sm">Kubernetes Management Tool</p>
                </div>
                <div className="w-12 h-12 rounded-lg overflow-hidden">
                  <img
                    src={logoUrl}
                    alt="Lumen Logo"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <div className="pt-4 border-t border-white/10">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Version</span>
                  <span className="text-white font-mono">{packageJson.version}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
