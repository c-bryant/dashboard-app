import type { Dispatch, SetStateAction } from 'react';
import SidebarGroupSubnav from './SidebarGroupSubnav';

import './SidebarNav.scss';
import { MdSettings } from 'react-icons/md';

const labels = ['Dashboard', 'Search', 'API', 'Settings'];

type Props = {
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
};

const SidebarNav = ({ activeIndex, setActiveIndex }: Props) => {
  return (
    <nav>
      <SidebarGroupSubnav
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
      />
      <div
        className="sidebar-nav"
        data-visible={activeIndex !== -1}
        aria-hidden={activeIndex === -1}
      >
        <div className="sidebar-nav__label" aria-live="polite">
          <div className="sidebar-panel" key={activeIndex}>
            <div className="sidebar-nav__label-header">
              {labels[activeIndex]}
            </div>
            {labels[activeIndex] === 'Dashboard' ? (
              <ul className="panel-list">
                <li>
                  <a href="#">Apps</a>
                </li>
                <li>
                  <MdSettings size={24} />
                  <a
                    onClick={() => {
                      setActiveIndex(3);
                    }}
                  >
                    Settings
                  </a>
                </li>
              </ul>
            ) : (
              <div className="panel-label">{labels[activeIndex]}</div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default SidebarNav;
