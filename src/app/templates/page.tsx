"use client";

import clsx from "clsx";
import styles from "./page.module.scss";
import { Button } from "@heroui/react";

const Templates = () => {
  return (
    <div className={clsx(styles.main, 'grid gap-[20]')}>
      <h1>
        <span className={styles.title}>hello，</span>
        <span className="text-3xl font-bold underline">world!</span>
      </h1>
      <Button onClick={() => console.log("hello world")}>My Button</Button>
    </div>
  );
};

export default Templates;
