import type { Dispatch, SetStateAction } from 'react';
import { MdApi, MdHomeFilled, MdSearch, MdSettings } from 'react-icons/md';

import './SidebarGroupSubnav.scss';

type Props = {
  activeIndex: number | null;
  setActiveIndex: Dispatch<SetStateAction<number>>;
};

const SidebarGroupSubnav = ({ activeIndex, setActiveIndex }: Props) => {
  const handleItemClick = (index: number) => {
    if (activeIndex !== index) {
      setActiveIndex(index);
    } else {
      setActiveIndex(-1);
    }
  };

  return (
    <div className="sidebar-group-subnav">
      <ul>
        <li>
          <div
            className={`icon-wrapper ${activeIndex === 0 ? 'active' : ''}`}
            onClick={() => handleItemClick(0)}
          >
            <MdHomeFilled size={30} title="Dashboard" />
          </div>
        </li>
        <li>
          <div
            className={`icon-wrapper ${activeIndex === 1 ? 'active' : ''}`}
            onClick={() => handleItemClick(1)}
          >
            <MdSearch size={30} title="Search" />
          </div>
        </li>
        <li>
          <div
            className={`icon-wrapper ${activeIndex === 2 ? 'active' : ''}`}
            onClick={() => handleItemClick(2)}
          >
            <MdApi size={30} title="API" />
          </div>
        </li>

        <li>
          <div
            className={`icon-wrapper ${activeIndex === 3 ? 'active' : ''}`}
            onClick={() => handleItemClick(3)}
          >
            <MdSettings size={30} title="Settings" />
          </div>
        </li>
      </ul>
    </div>
  );
};

export default SidebarGroupSubnav;
