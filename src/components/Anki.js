
import React, { useState, useEffect } from 'react';

const Anki = () => {
  const [version, setVersion] = useState(null);
  const [error, setError] = useState(null);

  const invoke = async (action, params = {}) => {
    const response = await fetch('http://localhost:8765', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, version: 6, params }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  };

  useEffect(() => {
    const getVersion = async () => {
      try {
        const result = await invoke('version');
        setVersion(result);
      } catch (e) {
        setError(e.message);
      }
    };
    getVersion();
  }, []);

  return (
    <div>
      <h2>Anki 連携</h2>
      {error ? (
        <p style={{ color: 'red' }}>
          AnkiConnectに接続できませんでした。Ankiが起動しており、AnkiConnectアドオンがインストールされていることを確認してください。
          <br />
          エラー: {error}
        </p>
      ) : (
        <p>AnkiConnect APIバージョン: {version}</p>
      )}
    </div>
  );
};

export default Anki;
