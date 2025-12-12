import React, { useState } from 'react';
import SidebarNav from './components/SidebarNav/SidebarNav';
import { MdPerson } from 'react-icons/md';

import './App.scss';
import InkBlobsCanvas from './components/InkBlobsBackground/InkBlobsCanvas';

const SidebarNavTyped = SidebarNav as React.ComponentType<{
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
}>;

function App() {
  const [activeIndex, setActiveIndex] = useState(-1);
  const labels = ['Dashboard', 'Search', 'API', 'Settings'];

  const renderContent = () => {
    switch (activeIndex) {
      case 0:
        return <></>;
      case 1:
        return <h2>Search Content</h2>;
      case 2:
        return <h2>API Content</h2>;
      case 3:
        return <h2>Settings Content</h2>;
      default:
        return <h2>Welcome! Please select an option from the sidebar.</h2>;
    }
  };

  return (
    <>
      <div className="layout-container">
        <div
          className="top-bar"
          aria-live="polite"
          // aria-hidden={activeIndex === -1}
          // data-visible={activeIndex !== -1}
        >
          <div>
            <span className="top-bar__label">{labels[activeIndex]}</span>
            <span style={{ textAlign: 'right' }}>
              <MdPerson
                size={30}
                title="User Profile"
                style={{ position: 'fixed', right: '90px', top: '24px' }}
              />
            </span>
          </div>
        </div>
        <SidebarNavTyped
          activeIndex={activeIndex}
          setActiveIndex={setActiveIndex}
        />
        <div className="content-area" data-sidebar-visible={activeIndex !== -1}>
          {activeIndex === 0 && <InkBlobsCanvas />}
          <div id="content">{renderContent()}</div>
        </div>

        <div
          className="overlay"
          aria-hidden={activeIndex === -1}
          data-visible={activeIndex !== -1}
        />
      </div>
    </>
  );
}

export default App;
