import chalk from 'chalk';

const prefix = {
  info:    chalk.cyan.bold('  ℹ'),
  success: chalk.green.bold('  ✔'),
  warn:    chalk.yellow.bold('  ⚠'),
  error:   chalk.red.bold('  ✖'),
  step:    chalk.magenta.bold('  →'),
  section: chalk.blue.bold('  ▶'),
};

export const logger = {
  info:    (msg: string) => console.log(`${prefix.info}  ${chalk.cyan(msg)}`),
  success: (msg: string) => console.log(`${prefix.success}  ${chalk.green(msg)}`),
  warn:    (msg: string) => console.log(`${prefix.warn}  ${chalk.yellow(msg)}`),
  error:   (msg: string) => console.error(`${prefix.error}  ${chalk.red(msg)}`),
  step:    (msg: string) => console.log(`${prefix.step}  ${chalk.white(msg)}`),
  section: (msg: string) => {
    console.log('');
    console.log(`${prefix.section}  ${chalk.blue.bold(msg)}`);
    console.log(chalk.blue('  ' + '─'.repeat(msg.length + 4)));
  },
  dim:     (msg: string) => console.log(`     ${chalk.gray(msg)}`),
  blank:   () => console.log(''),
  banner:  () => {
    console.log('');
    console.log(chalk.magenta.bold('  ╔══════════════════════════════════════════════╗'));
    console.log(chalk.magenta.bold('  ║') + chalk.white.bold('        Figma → HTML Generator v1.0.0         ') + chalk.magenta.bold('║'));
    console.log(chalk.magenta.bold('  ║') + chalk.gray('    Pixel-perfect. Responsive. Bootstrap.     ') + chalk.magenta.bold('║'));
    console.log(chalk.magenta.bold('  ╚══════════════════════════════════════════════╝'));
    console.log('');
  },
};
